import test from "node:test";
import assert from "node:assert/strict";
import { createHmac,randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { encryptCredential } from "../credentialCrypto";
import { EmailService, type PreparedEmailAdmission, type PreparedEmail } from "../email/emailService";
import pg from "pg";
import { billingDeps,billingServer,fixtureSecret,ownedDatabase,routeFixtureProviders } from "./billingRecoveryTestFixtures";
import { dispatchBillingEmails,reconcileBilling } from "./billingRecovery";

test("real signed billing HTTP/PG/provider HTTP recovery boundaries", async t => {
  const pool = new pg.Pool({ connectionString: ownedDatabase() }),deps = billingDeps(pool);
  assert.deepEqual((await pool.query("SELECT current_database() AS db,current_user AS actor")).rows[0],{ db: "eh02_disposable",actor: "eh02" });
  const sessions = new Map<string,Record<string,unknown>>(),subscriptions = new Map<string,Record<string,unknown>>();
  const previousPrices = ["STRIPE_PRICE_ID_PRO","STRIPE_PRICE_ID_PRO_PLUS","STRIPE_PRICE_ID_MAX"].map(key => [key,process.env[key]] as const);
  Object.assign(process.env,{ STRIPE_PRICE_ID_PRO: "price_pro",STRIPE_PRICE_ID_PRO_PLUS: "price_plus",STRIPE_PRICE_ID_MAX: "price_max" });
  const checkoutRequests: URLSearchParams[] = [];
  const deliveryAttemptsByKey = new Map<string,number>();
  const messages = new Map<string,string>();let deliveryAttempts = 0,mailFailure = false;
  const vendor = createServer(async (request,response) => {
    const path = new URL(request.url!,"http://127.0.0.1").pathname;
    response.setHeader("content-type","application/json");
    if (path.startsWith("/v1/")) assert.equal(request.headers.authorization,"Bearer sk_fixture_not_live");
    if (path === "/v1/checkout/sessions" && request.method === "POST") {
      const chunks: Buffer[] = [];for await(const chunk of request) chunks.push(Buffer.from(chunk));
      checkoutRequests.push(new URLSearchParams(Buffer.concat(chunks).toString()));
      response.end(JSON.stringify({ id:`cs_created_${randomUUID()}`,url:"https://checkout.stripe.com/fixture" }));return;
    }
    if (path.startsWith("/v1/checkout/sessions/")) { response.end(JSON.stringify(sessions.get(path.split("/").at(-1)!) ?? {}));return; }
    if (path.startsWith("/v1/subscriptions/")) { response.end(JSON.stringify(subscriptions.get(path.split("/").at(-1)!) ?? {}));return; }
    if (path === "/emails") {
      deliveryAttempts++;const chunks: Buffer[] = [];for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const key = String(request.headers["idempotency-key"] ?? ""),body = Buffer.concat(chunks).toString();
      assert.ok(key.startsWith("billing/checkout/"));
      deliveryAttemptsByKey.set(key,(deliveryAttemptsByKey.get(key) ?? 0)+1);
      if (mailFailure) { response.writeHead(503);response.end("{}");return; }
      if (messages.has(key)) assert.equal(body,messages.get(key),"recovery must retain identical provider request");
      else messages.set(key,body);
      response.end(JSON.stringify({ id: `fixture-email-${messages.size}` }));return;
    }
    response.writeHead(404);response.end("{}");
  });
  await new Promise<void>(resolve => vendor.listen(0,"127.0.0.1",resolve));
  const vendorBase = `http://127.0.0.1:${(vendor.address() as { port: number }).port}`,restore = routeFixtureProviders(vendorBase);
  const server = await billingServer(deps);
  function signup() {
    const suffix = randomUUID(),id = `cs_${suffix}`,customer = `cus_${suffix}`,subscription = `sub_${suffix}`,email = `buyer-${suffix}@demo.local`;
    const session = { id,status: "complete",payment_status: "paid",customer,subscription,customer_email: email,
      metadata: { org_name: `EH09 ${suffix}`,admin_email: email,seat_count: "2",usage_tier: "pro",stripe_price_id: "price_pro" } };
    sessions.set(id,session);subscriptions.set(subscription,{ id: subscription,customer,status: "active",items: { data: [{ id: `si_${suffix}`,quantity: 2,price: { id: "price_pro" } }] } });
    return { id,customer,subscription,email,session,event: { id: `evt_${suffix}`,type: "checkout.session.completed",data: { object: { id,customer } } } };
  }
  async function send(event: unknown,base = server.base,signatureValid = true) {
    const body = JSON.stringify(event),timestamp = String(Math.floor(Date.now()/1000));
    const signature = createHmac("sha256",fixtureSecret).update(`${timestamp}.${body}`).digest("hex");
    return fetch(`${base}/webhooks/stripe`,{ method: "POST",headers: { "content-type": "application/json",
      "stripe-signature": `t=${timestamp},v1=${signatureValid ? signature : "0".repeat(64)}` },body });
  }
  async function effects(customer: string) {
    return (await pool.query(`SELECT
      (SELECT count(*)::int FROM organizations WHERE stripe_customer_id=$1) AS orgs,
      (SELECT count(*)::int FROM users u JOIN organizations o ON o.id=u.org_id WHERE o.stripe_customer_id=$1) AS users,
      (SELECT count(*)::int FROM auth_tokens a JOIN users u ON u.id=a.user_id JOIN organizations o ON o.id=u.org_id WHERE o.stripe_customer_id=$1) AS tokens,
      (SELECT count(*)::int FROM billing_checkout_receipts WHERE customer_id=$1) AS receipts,
      (SELECT count(*)::int FROM billing_email_outbox b JOIN organizations o ON o.id=b.org_id WHERE o.stripe_customer_id=$1) AS notifications`,[customer])).rows[0];
  }
  async function waitFor(check: () => boolean | Promise<boolean>) {
    const end = Date.now()+5000;while(Date.now()<end) { if(await check()) return;await new Promise(resolve => setTimeout(resolve,15)); }assert.fail("controlled boundary not reached");
  }
  try {
    await t.test("signature and required event identity reject before claims/effects",async () => {
      const x = signup();assert.equal((await send(x.event,server.base,false)).status,400);
      assert.equal((await send({ ...x.event,id: "" })).status,400);
      assert.deepEqual(await effects(x.customer),{ orgs: 0,users: 0,tokens: 0,receipts: 0,notifications: 0 });
    });
    await t.test("concurrent duplicate plus poll/webhook race creates one org/admin/invite/receipt/mail",async () => {
      const x = signup(),before = messages.size;
      const responses = await Promise.all([send(x.event),send(x.event),fetch(`${server.base}/v1/billing/checkout-status?session_id=${x.id}`)]);
      assert.ok(responses.some(response => response.status===200));
      assert.equal((await send(x.event)).status,200);
      assert.deepEqual(await effects(x.customer),{ orgs: 1,users: 1,tokens: 1,receipts: 1,notifications: 1 });
      assert.equal(messages.size,before+1);
      const org = await deps.orgStore!.findOrganizationByStripeCustomerId(x.customer);
      const user = await deps.userStore!.findOrgUserByEmail(org!.id,x.email);assert.equal(user?.role,"admin");
      assert.equal((await deps.orgStore!.getOrganizationBilling(org!.id))?.seatCount,2);
    });
    await t.test("actual checkout creation admission preserves server/authenticated metadata provenance",async () => {
      const a = await deps.orgStore!.createOrganization(`EH09 authority ${randomUUID()}`,"free");
      const b = await deps.orgStore!.createOrganization(`EH09 foreign ${randomUUID()}`,"free");
      const member = await deps.userStore!.createUser(a.id,`member-${randomUUID()}@demo.local`,"member");
      const admin = await deps.userStore!.createUser(a.id,`admin-${randomUUID()}@demo.local`,"admin");
      const memberToken = (await deps.userStore!.createSession(member.id,a.id,{authProvider:"password"})).token;
      const adminToken = (await deps.userStore!.createSession(admin.id,a.id,{authProvider:"password"})).token;
      const post = (path: string,token: string,body: unknown) => fetch(`${server.base}${path}`,{ method:"POST",
        headers:{ "content-type":"application/json",...(token ? { authorization:`Bearer ${token}` } : {}) },body:JSON.stringify(body) });
      const forged = { existingOrgId:b.id,upgrade:true,googleSub:"unverified-subject",email:admin.email,seats:2 };
      assert.equal((await post("/v1/billing/upgrade-checkout-session","",forged)).status,401);
      assert.equal((await post("/v1/billing/upgrade-checkout-session",memberToken,forged)).status,403);
      assert.equal((await post("/v1/billing/upgrade-checkout-session",adminToken,forged)).status,200);
      const upgrade = checkoutRequests.at(-1)!;
      assert.equal(upgrade.get("metadata[existing_org_id]"),a.id);assert.equal(upgrade.get("metadata[google_sub]"),null);
      assert.equal(upgrade.get("metadata[admin_email]"),admin.email);
      assert.equal((await post("/v1/billing/checkout-session","",{ ...forged,email:`new-${randomUUID()}@demo.local` })).status,200);
      const publicCheckout = checkoutRequests.at(-1)!;
      assert.equal(publicCheckout.get("metadata[existing_org_id]"),null);assert.equal(publicCheckout.get("metadata[upgrade]"),null);
      assert.equal(publicCheckout.get("metadata[google_sub]"),null);
      assert.equal((await deps.userStore!.getUser(member.id))?.role,"member");assert.equal((await deps.orgStore!.getOrganization(b.id))?.plan,"free");
    });
    await t.test("current checkout quantity/SKU and later mixed inventory ignore stale pricing metadata",async () => {
      const x=signup();x.session.metadata.usage_tier="max";x.session.metadata.seat_count="20";
      assert.equal((await send(x.event)).status,200);
      const org=await deps.orgStore!.findOrganizationByStripeCustomerId(x.customer),user=await deps.userStore!.findOrgUserByEmail(org!.id,x.email);
      assert.equal(user?.usageTier,"pro");assert.equal((await deps.orgStore!.getOrganizationBilling(org!.id))?.seatCount,2);
      subscriptions.get(x.subscription)!.items={ data:[{id:"si_pro",quantity:4,price:{id:"price_pro"}},{id:"si_max",quantity:1,price:{id:"price_max"}}] };
      assert.equal((await send({id:`evt_mix_${randomUUID()}`,type:"customer.subscription.updated",data:{object:{id:x.subscription,customer:x.customer}}})).status,200);
      const billing=await deps.orgStore!.getOrganizationBilling(org!.id);assert.equal(billing?.seatCount,5);
      assert.deepEqual(billing?.seatInventory,{pro:4,pro_plus:0,max:1});assert.equal((await deps.userStore!.getUser(user!.id))?.usageTier,"pro");
      assert.equal((await send({ ...x.event,id:`evt_again_${randomUUID()}` })).status,200);
      assert.deepEqual(await effects(x.customer),{orgs:1,users:1,tokens:1,receipts:1,notifications:1});
    });
    await t.test("lease expiry after actual provisioning rolls all effects back and retries safely",async () => {
      const x=signup();
      const expiringPool=new Proxy(pool,{get(target,key){
        if(key==="connect") return async()=>{
          await target.query("UPDATE stripe_webhook_events SET lease_expires_at=clock_timestamp()+INTERVAL '500 milliseconds' WHERE event_id=$1",[x.event.id]);
          const client=await target.connect();return new Proxy(client,{get(connection,property){
            if(property==="query") return async(...args:unknown[])=>{
              if(String(args[0]).includes("UPDATE stripe_webhook_events SET status='completed'")) await new Promise(resolve=>setTimeout(resolve,650));
              return Reflect.apply(connection.query,connection,args);
            };
            const value=Reflect.get(connection,property);return typeof value==="function" ? value.bind(connection):value;
          }});
        };
        const value=Reflect.get(target,key);return typeof value==="function" ? value.bind(target):value;
      }});
      const expiring=await billingServer(billingDeps(expiringPool));
      try{
        assert.equal((await send(x.event,expiring.base)).status,500);
        assert.deepEqual(await effects(x.customer),{orgs:0,users:0,tokens:0,receipts:0,notifications:0});
        assert.equal((await send(x.event)).status,200);
        assert.deepEqual(await effects(x.customer),{orgs:1,users:1,tokens:1,receipts:1,notifications:1});
      }finally{await expiring.close();}
    });
    await t.test("foreign replaced subscription and suspended target cannot gain entitlements",async()=>{
      const x=signup();assert.equal((await send(x.event)).status,200);
      const org=await deps.orgStore!.findOrganizationByStripeCustomerId(x.customer);
      await deps.orgStore!.updateOrganizationBilling(org!.id,{stripeSubscriptionId:`sub_replaced_${randomUUID()}`});
      subscriptions.get(x.subscription)!.items={data:[{id:"si_wrong",quantity:99,price:{id:"price_max"}}]};
      assert.equal((await send({id:`evt_old_${randomUUID()}`,type:"customer.subscription.updated",data:{object:{id:x.subscription,customer:x.customer}}})).status,200);
      assert.equal((await deps.orgStore!.getOrganizationBilling(org!.id))?.seatCount,2);
      const target=await deps.orgStore!.createOrganization(`EH09 suspended ${randomUUID()}`,"free"),blocked=signup();
      Object.assign(blocked.session.metadata,{existing_org_id:target.id,upgrade:"true"});
      await pool.query("UPDATE organizations SET operator_status='suspended' WHERE id=$1",[target.id]);
      assert.equal((await send(blocked.event)).status,500);
      assert.equal((await deps.orgStore!.getOrganization(target.id))?.plan,"free");assert.equal((await effects(blocked.customer)).users,0);
    });
    for (const stage of ["claimed","effect","before-complete","committed","mail-admitted"]) {
      await t.test(`actual SIGKILL at ${stage} recovers without duplicated durable effects`,async () => {
        const x = signup(),before = messages.size;
        const child = spawn(process.execPath,["--import","tsx","src/server/billing/billingRecoveryTestFixtures.ts","--crash-worker",stage],{
          env: { ...process.env,EH09_FIXTURE_VENDOR_BASE: vendorBase,EH09_CRASH_CHECKOUT_ID:x.id },stdio: ["ignore","pipe","pipe"] });
        let output = "";child.stdout.on("data",chunk => { output+=String(chunk); });
        let pending: Promise<Response | undefined> | undefined;
        try {
          await waitFor(() => output.includes("READY "));
          const base = /READY (http:\/\/127\.0\.0\.1:\d+)/.exec(output)![1];
          pending = send(x.event,base).catch(() => undefined);await waitFor(() => output.includes("REACHED"));
          const exit = once(child,"exit");child.kill("SIGKILL");await exit;await pending;
          const expected = ["committed","mail-admitted"].includes(stage) ? 1 : 0;
          assert.deepEqual(await effects(x.customer),{ orgs: expected,users: expected,tokens: expected,receipts: expected,notifications: expected });
          await pool.query("UPDATE stripe_webhook_events SET lease_expires_at=clock_timestamp()-INTERVAL '1 second' WHERE event_id=$1 AND status='processing'",[x.event.id]);
          if(stage==="mail-admitted") await pool.query("UPDATE billing_email_outbox SET lease_expires_at=clock_timestamp()-INTERVAL '1 second' WHERE delivery_key=$1 AND status='sending'",[`billing/checkout/${x.id}`]);
          assert.equal((await send(x.event)).status,200);
          assert.deepEqual(await effects(x.customer),{ orgs: 1,users: 1,tokens: 1,receipts: 1,notifications: 1 });
          assert.equal(messages.size,before+1);
        } finally { if(child.exitCode===null && child.signalCode===null) child.kill("SIGKILL");if(pending) await pending; }
      });
    }
    await t.test("old unreceipted checkout cannot replace established subscription via webhook/poll/reconciler; current lineage and receipted history remain supported",async()=>{
      const x=signup(),replacement=`sub_current_${randomUUID()}`;
      const org=await deps.orgStore!.createOrganization(`EH09 lineage ${randomUUID()}`,"free");
      await deps.userStore!.createUser(org.id,x.email,"admin","max");
      await deps.orgStore!.setOrganizationPlan(org.id,"pro");
      await deps.orgStore!.updateOrganizationBilling(org.id,{stripeCustomerId:x.customer,stripeSubscriptionId:replacement,
        billingStatus:"active",seatCount:9,usageTier:"max",stripePriceId:"price_max",seatInventory:{pro:0,pro_plus:0,max:9}});
      Object.assign(x.session.metadata,{existing_org_id:org.id,upgrade:"true"});
      subscriptions.set(replacement,{id:replacement,customer:x.customer,status:"active",items:{data:[{id:"si_current",quantity:9,price:{id:"price_max"}}]}});
      const before=await effects(x.customer);
      assert.equal((await send(x.event)).status,500);
      const poll=await fetch(`${server.base}/v1/billing/checkout-status?session_id=${x.id}`);
      assert.equal(poll.status,200);assert.equal((await poll.json() as {status:string}).status,"pending");
      await pool.query("UPDATE stripe_webhook_events SET retry_after=NULL WHERE event_id=$1",[x.event.id]);
      const recovery=await reconcileBilling(deps,deps.stripeService!,64);assert.ok(recovery.failed>=1);
      assert.deepEqual(await effects(x.customer),before);
      assert.equal((await deps.orgStore!.getOrganizationBilling(org.id))?.stripeSubscriptionId,replacement);
      assert.equal((await deps.orgStore!.getOrganizationBilling(org.id))?.seatCount,9);
      const currentId=`cs_current_${randomUUID()}`;
      sessions.set(currentId,{...x.session,id:currentId,subscription:replacement});
      const currentEvent={id:`evt_current_${randomUUID()}`,type:x.event.type,data:{object:{id:currentId,customer:x.customer}}};
      assert.equal((await send(currentEvent)).status,200);
      assert.equal((await effects(x.customer)).receipts,1);
      const future=`sub_future_${randomUUID()}`;
      await deps.orgStore!.updateOrganizationBilling(org.id,{stripeSubscriptionId:future,seatCount:12,seatInventory:{pro:0,pro_plus:0,max:12}});
      assert.equal((await send({...currentEvent,id:`evt_history_${randomUUID()}`})).status,200);
      assert.equal((await deps.orgStore!.getOrganizationBilling(org.id))?.stripeSubscriptionId,future);
      assert.equal((await deps.orgStore!.getOrganizationBilling(org.id))?.seatCount,12);
      const history=await fetch(`${server.base}/v1/billing/checkout-status?session_id=${currentId}`);
      assert.equal((await history.json() as {status:string}).status,"ready");
    });
    for(const transition of ["uncertain","reclaimed","valid"] as const){
      await t.test(`delayed claimed email ${transition} rechecks durable ownership/window before provider effect`,async()=>{
        const org=await deps.orgStore!.createOrganization(`EH09 email ${randomUUID()}`,"pro"),key=`billing/checkout/cs_paused_${randomUUID()}`;
        const message=deps.emailService!.prepareWelcome({to:`mail-${randomUUID()}@demo.local`,orgName:org.name,adminPortalUrl:"https://admin.coop-ai.dev/login"});
        await pool.query("INSERT INTO billing_email_outbox(delivery_key,org_id,kind,encrypted_payload,first_attempt_at) VALUES($1,$2,'welcome',$3,clock_timestamp()-INTERVAL '22 hours')",
          [key,org.id,encryptCredential(JSON.stringify(message),deps.serverConfig.credentialsEncryptionKey!)]);
        let enter!:()=>void,resume!:()=>void;
        const reached=new Promise<void>(resolve=>{enter=resolve;}),resumed=new Promise<void>(resolve=>{resume=resolve;});
        const delayedPool=new Proxy(pool,{get(target,property){
          if(property==="query")return async(...args:unknown[])=>{
            const result=await Reflect.apply(target.query,target,args);
            if(String(args[0]).includes("UPDATE billing_email_outbox SET status='sending',attempt_token")&&(args[1] as unknown[])?.[0]===key){enter();await resumed;}
            return result;
          };
          const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;
        }});
        const old=dispatchBillingEmails({...deps,pool:delayedPool},64);await reached;
        try{
          if(transition==="uncertain"){
            await pool.query("UPDATE billing_email_outbox SET first_attempt_at=clock_timestamp()-INTERVAL '25 hours',lease_expires_at=clock_timestamp()-INTERVAL '1 second' WHERE delivery_key=$1",[key]);
            await dispatchBillingEmails(deps,64);
            assert.equal((await pool.query("SELECT status FROM billing_email_outbox WHERE delivery_key=$1",[key])).rows[0].status,"uncertain");
          }else if(transition==="reclaimed"){
            await pool.query("UPDATE billing_email_outbox SET lease_expires_at=clock_timestamp()-INTERVAL '1 second' WHERE delivery_key=$1",[key]);
            await dispatchBillingEmails(deps,64);assert.ok(messages.has(key));
          }
          const attemptsBeforeResume=deliveryAttemptsByKey.get(key) ?? 0;
          resume();await old;
          assert.equal(deliveryAttemptsByKey.get(key) ?? 0,attemptsBeforeResume+(transition==="valid"?1:0));
          assert.equal(messages.has(key),transition!=="uncertain");
          assert.equal((await pool.query("SELECT status FROM billing_email_outbox WHERE delivery_key=$1",[key])).rows[0].status,transition==="uncertain"?"uncertain":"sent");
        }finally{resume();await old;}
      });
    }
    await t.test("expiry after row-locked admission and timer-independent clocks deny actual mail fetch",async()=>{
      const org=await deps.orgStore!.createOrganization(`EH09 mail deadline ${randomUUID()}`,"pro"),key=`billing/checkout/cs_deadline_${randomUUID()}`;
      const message=deps.emailService!.prepareWelcome({to:`deadline-${randomUUID()}@demo.local`,orgName:org.name,adminPortalUrl:"https://admin.coop-ai.dev/login"});
      await pool.query("INSERT INTO billing_email_outbox(delivery_key,org_id,kind,encrypted_payload) VALUES($1,$2,'welcome',$3)",[key,org.id,encryptCredential(JSON.stringify(message),deps.serverConfig.credentialsEncryptionKey!)]);
      const shortPool=new Proxy(pool,{get(target,property){
        if(property==="query")return async(...args:unknown[])=>{
          const result=await Reflect.apply(target.query,target,args);
          if(String(args[0]).includes("UPDATE billing_email_outbox SET status='sending',attempt_token")&&(args[1] as unknown[])?.[0]===key)
            await target.query("UPDATE billing_email_outbox SET lease_expires_at=clock_timestamp()+INTERVAL '400 milliseconds' WHERE delivery_key=$1",[key]);
          return result;
        };const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;
      }});
      class PausedEmail extends EmailService{
        public override async sendPrepared(prepared:PreparedEmail,deliveryKey:string,admission:PreparedEmailAdmission){
          if(deliveryKey===key) await new Promise(resolve=>setTimeout(resolve,650));
          return super.sendPrepared(prepared,deliveryKey,admission);
        }
      }
      const config=(await import('./billingConfig')).loadBillingConfig({RESEND_API_KEY:"re_fixture_not_live",COOP_EMAIL_MOCK:"false",COOP_PUBLIC_BASE_URL:"https://api.coop-ai.dev"});
      await dispatchBillingEmails({...deps,pool:shortPool,emailService:new PausedEmail(config)},64);
      assert.equal(messages.has(key),false);
      const signal=new AbortController().signal;
      for(const deadline of [{wallDeadlineMs:Date.now()-1,monotonicDeadlineMs:performance.now()+10000},
        {wallDeadlineMs:Date.now()+10000,monotonicDeadlineMs:performance.now()-1}]){
        await assert.rejects(deps.emailService!.sendPrepared(message,key,{signal,...deadline}),/admission expired/);
      }
      assert.equal(messages.has(key),false);
      await pool.query("UPDATE billing_email_outbox SET retry_after=NULL WHERE delivery_key=$1",[key]);
      await dispatchBillingEmails(deps,64);assert.ok(messages.has(key),"supported fresh retry succeeds");
    });
    await t.test("abandoned legacy processing claim recovers on signed delivery",async () => {
      const x = signup();await pool.query("INSERT INTO stripe_webhook_events(event_id,event_type,status,processed_at) VALUES($1,$2,'processing','2000-01-01')",[x.event.id,x.event.type]);
      assert.equal((await send(x.event)).status,200);assert.equal((await effects(x.customer)).orgs,1);
    });
    await t.test("expired/replaced old attempt cannot apply or fail a new attempt",async () => {
      const x = signup();let enter!:()=>void,resume!:()=>void;
      const reached = new Promise<void>(resolve => { enter=resolve; }),resumed = new Promise<void>(resolve => { resume=resolve; });
      let paused = false;
      const slowPool = new Proxy(pool,{ get(target,key) {
        if(key==="connect") return async () => { if(!paused) { paused=true;enter();await resumed; }return target.connect(); };
        const value=Reflect.get(target,key);return typeof value==="function" ? value.bind(target) : value;
      } });
      const slow = await billingServer(billingDeps(slowPool));
      try {
        const pending=send(x.event,slow.base);await reached;
        await pool.query("UPDATE stripe_webhook_events SET lease_expires_at=clock_timestamp()-INTERVAL '1 second' WHERE event_id=$1",[x.event.id]);
        assert.equal((await send(x.event)).status,200);
        const current=subscriptions.get(x.subscription)!;current.items={ data: [{ id: "si_new",quantity: 9,price: { id: "price_pro" } }] };
        assert.equal((await send({ id: `evt_new_${randomUUID()}`,type: "customer.subscription.updated",data: { object: { id:x.subscription,customer:x.customer,status:"active",quantity:2 } } })).status,200);
        resume();assert.equal((await pending).status,500);
        const org=await deps.orgStore!.findOrganizationByStripeCustomerId(x.customer);
        assert.equal((await deps.orgStore!.getOrganizationBilling(org!.id))?.seatCount,9);
        assert.equal((await pool.query("SELECT status FROM stripe_webhook_events WHERE event_id=$1",[x.event.id])).rows[0].status,"completed");
      } finally { resume();await slow.close(); }
    });
    await t.test("provider current truth defeats delayed updates, invoice failure and old cancellation",async () => {
      const x=signup();assert.equal((await send(x.event)).status,200);
      const org=await deps.orgStore!.findOrganizationByStripeCustomerId(x.customer);
      const update=async(type:string,snapshot:Record<string,unknown>={})=>send({ id:`evt_${randomUUID()}`,type,data:{ object:{ id:x.subscription,customer:x.customer,...snapshot } } });
      const current=subscriptions.get(x.subscription)!;
      current.items={ data:[{ id:"si_new",quantity:7,price:{ id:"price_pro" } }] };
      assert.equal((await update("customer.subscription.updated",{ items:{data:[{quantity:1}]},status:"active" })).status,200);
      assert.equal((await deps.orgStore!.getOrganizationBilling(org!.id))?.seatCount,7);
      current.status="past_due";assert.equal((await update("invoice.payment_failed",{ id:"in_fixture" })).status,200);
      assert.equal((await deps.orgStore!.getOrganizationBilling(org!.id))?.billingStatus,"past_due");
      current.status="active";assert.equal((await update("invoice.payment_failed",{ id:"in_old" })).status,200);
      assert.equal((await deps.orgStore!.getOrganizationBilling(org!.id))?.billingStatus,"active");
      assert.equal((await update("customer.subscription.deleted",{ status:"canceled" })).status,200);
      assert.equal((await deps.orgStore!.getOrganization(org!.id))?.plan,"pro");
      current.status="canceled";assert.equal((await update("customer.subscription.updated",{ status:"active" })).status,200);
      assert.equal((await deps.orgStore!.getOrganization(org!.id))?.plan,"free");
      const billing=await deps.orgStore!.getOrganizationBilling(org!.id);
      assert.equal(billing?.seatCount,1);assert.deepEqual(billing?.seatInventory,{ pro:0,pro_plus:0,max:0 });
      assert.equal((await deps.userStore!.findOrgUserByEmail(org!.id,x.email))?.usageTier,null);
    });
    await t.test("unsettled/mismatched checkout fails without entitlement or identity effects",async () => {
      for(const mismatch of ["payment","customer","subscription"]) {
        const x=signup();if(mismatch==="payment") x.session.payment_status="unpaid";
        else if(mismatch==="customer") subscriptions.get(x.subscription)!.customer=`cus_foreign_${randomUUID()}`;
        else subscriptions.get(x.subscription)!.id="sub_wrong";
        assert.equal((await send(x.event)).status,500);assert.equal((await effects(x.customer)).orgs,0);
      }
    });
    await t.test("email failure is durable; provider retry retains message/token and never blindly retries past window",async () => {
      const x=signup(),before=messages.size;mailFailure=true;assert.equal((await send(x.event)).status,200);mailFailure=false;
      assert.equal((await effects(x.customer)).tokens,1);assert.equal(messages.size,before);
      await pool.query("UPDATE billing_email_outbox SET retry_after=NULL WHERE delivery_key=$1",[`billing/checkout/${x.id}`]);
      assert.equal((await dispatchBillingEmails(deps)).sent,1);assert.equal(messages.size,before+1);
      // A sent payload is erased, so model the real acceptance-before-local-save
      // ambiguity using a separate pending immutable record and its successful send.
      const ambiguous=signup();mailFailure=true;assert.equal((await send(ambiguous.event)).status,200);mailFailure=false;
      const key=`billing/checkout/${ambiguous.id}`;
      await pool.query("UPDATE billing_email_outbox SET retry_after=NULL WHERE delivery_key=$1",[key]);
      const stored=(await pool.query("SELECT encrypted_payload FROM billing_email_outbox WHERE delivery_key=$1",[key])).rows[0].encrypted_payload;
      await dispatchBillingEmails(deps);const delivered=messages.size;
      await pool.query("UPDATE billing_email_outbox SET status='sending',encrypted_payload=$2,lease_expires_at=clock_timestamp()-INTERVAL '1 second' WHERE delivery_key=$1",[key,stored]);
      await dispatchBillingEmails(deps);assert.equal(messages.size,delivered);assert.equal((await effects(ambiguous.customer)).tokens,1);
      await pool.query("UPDATE billing_email_outbox SET status='sending',encrypted_payload=$2,first_attempt_at=clock_timestamp()-INTERVAL '25 hours',lease_expires_at=clock_timestamp()-INTERVAL '1 second' WHERE delivery_key=$1",[key,stored]);
      const attempts=deliveryAttempts;assert.ok((await dispatchBillingEmails(deps)).uncertain>=1);assert.equal(deliveryAttempts,attempts);
    });
    await t.test("bounded reconciler resolves provider-backed failed event and reports legacy unknown state",async () => {
      const x=signup();x.session.payment_status="unpaid";assert.equal((await send(x.event)).status,500);x.session.payment_status="paid";
      await pool.query("UPDATE stripe_webhook_events SET retry_after=NULL WHERE event_id=$1",[x.event.id]);
      await pool.query("INSERT INTO stripe_webhook_events(event_id,event_type,status) VALUES($1,'checkout.session.completed','failed')",[`evt_legacy_${randomUUID()}`]);
      const result=await reconcileBilling(deps,deps.stripeService!,64);assert.ok(result.completed>=1);assert.ok(result.legacyUnresolved>=1);
      assert.equal((await effects(x.customer)).receipts,1);
    });
    await t.test("actual operator CLI validates target, executes recovery and reports unresolved state",async()=>{
      const code = `const {routeFixtureProviders}=require('./src/server/billing/billingRecoveryTestFixtures.ts');
        routeFixtureProviders(process.env.EH09_FIXTURE_VENDOR_BASE);
        process.argv=['node','scripts/reconcile-billing.ts','--apply','eh02_disposable','eh02'];
        require('./scripts/reconcile-billing.ts').main().catch(()=>{process.exitCode=1});`;
      const child=spawn(process.execPath,["--import","tsx","--eval",code],{env:{...process.env,
        DATABASE_URL:ownedDatabase(),EH09_FIXTURE_VENDOR_BASE:vendorBase,
        STRIPE_SECRET_KEY:"sk_fixture_not_live",STRIPE_WEBHOOK_SECRET:fixtureSecret,RESEND_API_KEY:"re_fixture_not_live",
        COOP_EMAIL_MOCK:"false",COOP_PUBLIC_BASE_URL:"https://api.coop-ai.dev",CREDENTIALS_ENCRYPTION_KEY:"eh09-disposable-encryption-only"},
        stdio:["ignore","pipe","pipe"]});
      let output="";child.stdout.on("data",chunk=>{output+=String(chunk);});
      const [exit]=await once(child,"exit");assert.equal(exit,2,"legacy/uncertain state requires operator follow-up, not a silent pass");
      const report=JSON.parse(output.trim());assert.ok(report.legacyUnresolved>=1);assert.ok(report.email.uncertain>=1);
    });
  } finally {
    for(const [key,value] of previousPrices) { if(value===undefined) delete process.env[key];else process.env[key]=value; }
    await server.close();restore();await new Promise<void>(resolve=>vendor.close(()=>resolve()));await pool.end();
  }
});
