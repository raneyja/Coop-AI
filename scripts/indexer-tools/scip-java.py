"""Build and inventory the pinned complete SCIP-Java distribution; no JAR replacement."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import zipfile

PINS = json.loads(Path(__file__).with_name("scip-java.json").read_text())

def sha(data):
    return hashlib.sha256(data).hexdigest()

def jar_resources(distribution):
    rows = []
    names = set()
    def visit(data, origin, resource, depth=0):
        if depth > 4 or resource in names:
            raise ValueError("Duplicate or excessively nested Java resource")
        names.add(resource)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.namelist()
            if len(entries) != len(set(entries)):
                raise ValueError("Duplicate archive entries")
            if any(n.startswith("/") or ".." in PurePosixPath(n).parts for n in entries):
                raise ValueError("Unsafe archive entry")
            classes = [n for n in entries if n.endswith(".class")]
            own_classes = bool(classes) and all(n.startswith("org/scip_code/") for n in classes)
            project = None
            for candidate in ("scip-java", "scip-shared", "scip-aggregator"):
                if origin == "lib/" + candidate + "-" + PINS["releaseVersion"] + ".jar":
                    project = candidate
            if origin == "lib/scip-java-" + PINS["releaseVersion"] + ".jar!/gradle-plugin.jar":
                project = "scip-gradle-plugin"
            if project and not own_classes:
                raise ValueError("Unexpected external or missing classes in producer output: " + origin)
            row = {"resource": resource, "origin": origin, "sha256": sha(data), "bytes": len(data)}
            if project and own_classes:
                row["producerSource"] = {"project": project, "classCount": len(classes)}
            rows.append((row, data))
            for name in entries:
                if name.endswith(".jar"):
                    visit(archive.read(name), origin + "!/" + name, resource + "--" + PurePosixPath(name).name, depth + 1)
    for jar in sorted((distribution / "lib").glob("*.jar")):
        visit(jar.read_bytes(), "lib/" + jar.name, jar.name)
    if not rows:
        raise ValueError("Missing distribution JARs")
    return rows

def provenance(distribution):
    files = []
    for file in sorted(distribution.rglob("*")):
        if file.is_symlink():
            raise ValueError("Distribution symlinks unsupported")
        if file.is_file() and file.name != "provenance.json":
            files.append({"path": str(file.relative_to(distribution)), "sha256": sha(file.read_bytes())})
    resources = [row for row, _ in jar_resources(distribution)]
    return {"schema": "coop-scip-java-build-v1", "inputs": PINS, "files": files, "resources": resources, "sourceOnlyResources": [row for row in resources if "producerSource" in row]}

def export(distribution, output, inventory):
    recorded = json.loads((distribution / "provenance.json").read_text())
    if recorded != provenance(distribution):
        raise ValueError("Distribution build provenance or resource identity drift")
    output.mkdir(parents=True, exist_ok=True)
    if list(output.iterdir()):
        raise ValueError("Java export directory must be empty")
    resources = jar_resources(distribution)
    for row, data in resources:
        (output / row["resource"]).write_bytes(data)
    inventory.write_text(json.dumps({"components": [row for row, _ in resources], "buildProvenance": recorded}, indent=2) + "\n")

def build(output):
    work = Path("/tmp/coop-scip-java-build")
    work.mkdir(exist_ok=False)
    for kind in ("source", "gradle"):
        target = work / kind
        subprocess.run(["curl", "--fail", "--location", "--max-time", "180", PINS[kind + "Url"], "--output", str(target)], check=True)
        if sha(target.read_bytes()) != PINS[kind + "Sha256"]:
            raise ValueError("Producer input checksum mismatch: " + kind)
    with tarfile.open(work / "source") as archive:
        for member in archive.getmembers():
            if member.name.startswith("/") or ".." in PurePosixPath(member.name).parts or member.issym() or member.islnk():
                raise ValueError("Unsafe producer source archive")
        archive.extractall(work / "source-tree")
    with zipfile.ZipFile(work / "gradle") as archive:
        if any(n.startswith("/") or ".." in PurePosixPath(n).parts for n in archive.namelist()):
            raise ValueError("Unsafe Gradle archive")
        archive.extractall(work)
    source = next((work / "source-tree").iterdir())
    gradle = work / ("gradle-" + PINS["gradleVersion"]) / "bin/gradle"
    gradle.chmod(0o755)
    subprocess.run([str(gradle), ":scip-java:installDist", "--no-daemon", "--console=plain", "--max-workers=2", "-Dorg.gradle.jvmargs=-Xmx2g", "-PreleaseVersion=" + PINS["releaseVersion"]], cwd=source, check=True)
    shutil.copytree(source / "scip-java/build/install/scip-java", output)
    (output / "provenance.json").write_text(json.dumps(provenance(output), indent=2) + "\n")
    shutil.rmtree(work)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("build", "export"))
    parser.add_argument("--distribution", type=Path, default=Path("/opt/scip-java"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--inventory", type=Path)
    args = parser.parse_args()
    if args.mode == "build":
        build(args.distribution)
    elif args.output and args.inventory:
        export(args.distribution, args.output, args.inventory)
    else:
        parser.error("export requires --output and --inventory")
