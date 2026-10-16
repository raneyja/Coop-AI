import importlib.util
import io
import json
from pathlib import Path
import tempfile
import sys
sys.dont_write_bytecode = True
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("producer", Path(__file__).with_name("scip-java.py"))
producer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(producer)

def jar(entries):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        for name, body in entries.items():
            archive.writestr(name, body)
    return stream.getvalue()

class ProducerInventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.dist = self.root / "dist"
        (self.dist / "lib").mkdir(parents=True)
        self.main = self.dist / "lib" / ("scip-java-" + producer.PINS["releaseVersion"] + ".jar")
        self.main.write_bytes(jar({"org/scip_code/scip_java/Main.class": b"synthetic", "gradle-plugin.jar": jar({"org/scip_code/scip_java/Plugin.class": b"synthetic"})}))
    def tearDown(self):
        self.temp.cleanup()
    def test_complete_nested_export_and_producer_classification(self):
        proof = producer.provenance(self.dist)
        self.assertEqual(len(proof["resources"]), 2)
        self.assertEqual(len(proof["sourceOnlyResources"]), 2)
        (self.dist / "provenance.json").write_text(json.dumps(proof))
        producer.export(self.dist, self.root / "out", self.root / "inventory.json")
        self.assertEqual(len(list((self.root / "out").iterdir())), 2)
        self.assertEqual(json.loads((self.root / "inventory.json").read_text())["buildProvenance"], proof)
    def test_changed_archive_and_forged_provenance_fail(self):
        proof = producer.provenance(self.dist)
        (self.dist / "provenance.json").write_text(json.dumps(proof))
        self.main.write_bytes(jar({"org/scip_code/scip_java/Changed.class": b"synthetic"}))
        with self.assertRaisesRegex(ValueError, "drift"):
            producer.export(self.dist, self.root / "out", self.root / "inventory.json")
    def test_foreign_classes_cannot_be_declared_producer_source(self):
        self.main.write_bytes(jar({"foreign/dependency/Undeclared.class": b"synthetic"}))
        with self.assertRaisesRegex(ValueError, "Unexpected external"):
            producer.provenance(self.dist)
    def test_unsafe_nested_entries_fail(self):
        self.main.write_bytes(jar({"../escape.class": b"synthetic"}))
        with self.assertRaisesRegex(ValueError, "Unsafe"):
            producer.provenance(self.dist)
    def test_extra_archive_cannot_borrow_existing_provenance(self):
        (self.dist / "provenance.json").write_text(json.dumps(producer.provenance(self.dist)))
        (self.dist / "lib" / "extra.jar").write_bytes(jar({"foreign/Dependency.class": b"synthetic"}))
        with self.assertRaisesRegex(ValueError, "drift"):
            producer.export(self.dist, self.root / "out", self.root / "inventory.json")

if __name__ == "__main__":
    unittest.main()
