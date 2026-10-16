// Fresh suite-bound actual Docker admission must precede all database constructors.
const {publicationDatabaseFromEnvironment} = require('../../scripts/publication-test-fixture.mjs');
const releaseDatabase: string = publicationDatabaseFromEnvironment(process.env, 'threads');
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { before, after, test } from "node:test";
import type { ServerResponse } from "node:http";
import { Pool } from "pg";
import { ChatThreadsStore, ChatThreadWriteForbiddenError, type UpsertThreadInput } from "./chatThreadsStore";
import { handleChatThreadsApiRequest } from "./chatThreadsApi";
import { loadServerConfig } from "./serverConfig";
import type { UserStore } from "./users/userStore";

const pool = new Pool({connectionString: releaseDatabase, ssl:false, max:6,connectionTimeoutMillis:2000,statement_timeout:5000,application_name:'eh12-thread-write-fixture'});
const store = new ChatThreadsStore(pool);
let orgA: string, orgB: string, userA: string, userB: string, userC: string;
before(async () => {
  const schema = await pool.query("SELECT to_regclass('public.chat_threads') AS existing");
  if (!schema.rows[0].existing) {
    await pool.query("CREATE TABLE organizations (id UUID PRIMARY KEY); CREATE TABLE users (id UUID PRIMARY KEY)");
    await pool.query(readFileSync("migrations/019_chat_threads.sql", "utf8"));
  }
  orgA = randomUUID(); orgB = randomUUID(); userA = randomUUID(); userB = randomUUID(); userC = randomUUID();
  await pool.query("INSERT INTO organizations(id) VALUES ($1),($2)", [orgA,orgB]);
  await pool.query("INSERT INTO users(id) VALUES ($1),($2),($3)", [userA,userB,userC]);
});
after(async () => { await pool.end(); });
function input(id: string, orgId: string, userId: string, content = "Original synthetic fixture"): UpsertThreadInput {
  return { id, orgId, userId, principal: "user:" + userId, writeScope: { userId, principal: "user:" + userId }, title: content,
    messages: [{ id: id + "-message", role: "user", content, sortOrder: 0 }] };
}
async function snapshot(id: string) {
  return { row: (await pool.query("SELECT * FROM chat_threads WHERE id=$1", [id])).rows[0], messages: await store.getThreadMessages(id) };
}
for (const otherOrganization of [true,false]) {
  test(`existing row keeps organization, owner and messages when another ${otherOrganization ? "organization" : "writer"} collides`, async () => {
    const id = "fixture-" + randomUUID(); await store.upsertThread(input(id,orgA,userA)); const before = await snapshot(id);
    if (otherOrganization) assert.equal(await store.getThread(orgB,id),undefined);
    await assert.rejects(store.upsertThread(input(id,otherOrganization ? orgB : orgA,otherOrganization ? userB : userC,"Rejected synthetic replacement")), ChatThreadWriteForbiddenError);
    assert.deepEqual(await snapshot(id),before);
  });
}
test("current owner can update an existing thread", async () => {
  const id = "fixture-" + randomUUID(); await store.upsertThread(input(id,orgA,userA));
  const row = await store.upsertThread(input(id,orgA,userA,"Allowed synthetic update"));
  assert.equal(row.userId,userA); assert.equal(row.orgId,orgA);
  assert.equal((await store.getThreadMessages(id))[0].content,"Allowed synthetic update");
});
test("API-key attribution stays immutable while its original key and named human can write", async () => {
  const id = "fixture-" + randomUUID(); const key = "apikey:fixture-key";
  const first = { ...input(id,orgA,userA), principal:key, writeScope:{principal:key} };
  await store.upsertThread(first);
  await store.upsertThread({...first,userId:userC,messages:[{id:id+"-message",role:"user",content:"Key update",sortOrder:0}]});
  assert.equal((await store.getThread(orgA,id))?.userId,userA);
  await store.upsertThread(input(id,orgA,userA,"Named owner update"));
  const row = await store.getThread(orgA,id); assert.equal(row?.userId,userA); assert.equal(row?.principal,key);
});
test("unscoped writes fail before connecting", async () => {
  let connections=0;
  const unscopedStore=new ChatThreadsStore({connect:async()=>{connections++;throw new Error("unexpected connection");}} as unknown as Pool);
  const invalid={...input("fixture",orgA,userA),writeScope:undefined} as unknown as UpsertThreadInput;
  await assert.rejects(unscopedStore.upsertThread(invalid),ChatThreadWriteForbiddenError);assert.equal(connections,0);
});
test("message insertion failure rolls back an admitted update", async () => {
  const id="fixture-"+randomUUID(), other="fixture-"+randomUUID();
  await store.upsertThread(input(id,orgA,userA));await store.upsertThread(input(other,orgA,userA));const before=await snapshot(id);
  const invalid=input(id,orgA,userA,"Must roll back");invalid.messages[0].id=other+"-message";
  await assert.rejects(store.upsertThread(invalid),error=>(error as {code?:string}).code==="23505");
  assert.deepEqual(await snapshot(id),before);
});
test("simultaneous absent-row creation has one admitted owner", async () => {
  const id="fixture-"+randomUUID();assert.equal(await store.getThread(orgA,id),undefined);assert.equal(await store.getThread(orgA,id),undefined);
  let entered!:()=>void, release!:()=>void;
  const inserted=new Promise<void>(resolve=>{entered=resolve;});const barrier=new Promise<void>(resolve=>{release=resolve;});
  const heldPool={connect:async()=>{const client=await pool.connect();return {query:async(text:string,params?:unknown[])=>{
    const result=await client.query(text,params);if(text.includes("INSERT INTO chat_threads")){entered();await barrier;}return result;
  },release:()=>client.release()};}} as unknown as Pool;
  const first=new ChatThreadsStore(heldPool).upsertThread(input(id,orgA,userA,"First owner"));
  await inserted;
  const second=store.upsertThread(input(id,orgA,userC,"Second owner"));
  const denied=assert.rejects(second,ChatThreadWriteForbiddenError);
  try {
    const deadline=Date.now()+2000;let waiting=false;
    while(Date.now()<deadline && !waiting){const r=await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='eh12-thread-write-fixture' AND cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%INSERT INTO chat_threads%') AS waiting");waiting=r.rows[0].waiting;if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(waiting,true,"actual unique-row contention must be observed");
  } finally {release();}
  await first;await denied;assert.equal((await store.getThread(orgA,id))?.userId,userA);assert.equal((await store.getThreadMessages(id))[0].content,"First owner");
});
test("actual API handler returns a plain denial for an atomic collision", async () => {
  const id="fixture-"+randomUUID();await store.upsertThread(input(id,orgA,userA));const before=await snapshot(id);
  let status=0,body="";
  const response={writeHead:(code:number)=>{status=code;},end:(value:string)=>{body=value;}} as unknown as ServerResponse;
  const users={resolveUserSession:async(token:string)=>token==="fixture-session" ? {userId:userB,orgId:orgB,orgName:"Synthetic org",plan:"pro",role:"member"}:undefined} as unknown as UserStore;
  await handleChatThreadsApiRequest({method:"PUT",pathname:"/v1/threads/"+id,headers:{authorization:"Bearer fixture-session"},body:{title:"Rejected",messages:[{content:"Rejected",id:id+"-message"}]}},response,{threadsStore:store,userStore:users,serverConfig:loadServerConfig({NODE_ENV:"production",JOBS_WORKERS:"0"})});
  assert.equal(status,403);assert.deepEqual(JSON.parse(body),{error:"forbidden"});assert.deepEqual(await snapshot(id),before);
});
