"""What `app` state does the Tauri shell show at launch, before the user does anything?

Same technique as windows-client/src-tauri/tools/check-core.py: a temporary crate
compiled directly over the real shell modules, because the full Tauri dependency
graph needs a newer rustc than this machine has. This one adds a binary that
drives a real Supervisor over the Python fake sidecar and prints the state the
webview would paint at launch, for two config files:

  * invalid-but-parseable  — parses as JSON, fails the sidecar's rules
  * missing                — no config file at all (spawns `node` off PATH, so a
                             shim named `node` points at the same fixture)

Usage: python3 .claude/runs/2026-09-11-tauri-windows-client/prototypes/app-state-repro.py

Set MSFSLOGGER_SHELL to run it against a copy of src-tauri instead of the
checkout — that is how the pre-fix behaviour was reproduced (copy src-tauri
aside, restore the launch-time `if auto_uplink { worker.spawn(); }` and the
config-derived initial status in the copy, point this at it).
"""
from pathlib import Path
import json
import os
import subprocess
import tempfile
import tomllib

shell = Path(os.environ.get('MSFSLOGGER_SHELL')
             or Path(__file__).resolve().parents[4] / 'windows-client' / 'src-tauri')
manifest = tomllib.loads((shell / 'Cargo.toml').read_text())

REPRO = r'''
use serde_json::{json, Value};
use core_repro::{config::{lock, ConfigStore}, supervisor::{Event, Operation, Supervisor}};
use std::{fs, sync::{Arc, Mutex}, thread, time::Duration};

fn main() {
    let missing = std::env::args().any(|a| a == "missing");
    let root = std::env::temp_dir().join(format!("msfslogger-repro-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(root.join("dist")).unwrap();
    let entry = root.join("dist/index.js");
    fs::write(&entry, include_str!("__FIXTURE__")).unwrap();

    let config = ConfigStore::new(root.join("config.json"));
    if missing {
        fs::create_dir_all(root.join("shim")).unwrap();
        fs::write(root.join("shim/node"), "#!/bin/sh\nexec /usr/bin/python3 \"$@\"\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root.join("shim/node"), fs::Permissions::from_mode(0o755)).unwrap();
        std::env::set_var("PATH", format!("{}:{}", root.join("shim").display(),
            std::env::var("PATH").unwrap_or_default()));
    } else {
        config.save(json!({"nodePath":"/usr/bin/python3", "serverUrl":"ftp://nope",
            "ingestToken":"", "sim":"2019", "autoUplink":false})).unwrap();
    }
    let events: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
    let captured = events.clone();
    let sink = Arc::new(move |event| {
        let value = match event { Event::Status(v) | Event::Log(v) | Event::Exit(v) => v };
        lock(&captured).push(value);
    });
    let supervisor = Supervisor::new(config, Some(entry), sink).unwrap();
    thread::sleep(Duration::from_millis(600));
    let controls = || fs::read_to_string(root.join("controls")).unwrap_or_default();
    let state = |label: &str| {
        let snapshot = lock(&supervisor.snapshot);
        let status = snapshot.status.clone().unwrap_or(Value::Null);
        println!("{label}: app = {}  problems = {}  controls sent = {:?}",
            status["app"]["state"], status["app"]["problems"], controls());
    };
    state(if missing { "at launch, no config file" } else { "at launch, invalid config" });
    supervisor.request(Operation::Start).unwrap();
    thread::sleep(Duration::from_millis(400));
    state("after user presses START ");
    println!("sidecar processes started = {}",
        fs::read_to_string(root.join("starts")).unwrap_or_default().lines().count());
    supervisor.shutdown();
    drop(supervisor);
    let _ = fs::remove_dir_all(&root);
}
'''

with tempfile.TemporaryDirectory(prefix='msfslogger-app-state-repro-') as directory:
    scratch = Path(directory)
    scratch.joinpath('Cargo.toml').write_text(
        '[package]\nname="core-repro"\nversion="0.1.0"\nedition="2021"\n'
        '[lib]\nname="core_repro"\npath="lib.rs"\n[dependencies]\nserde_json=' +
        json.dumps(manifest['dependencies']['serde_json']) + '\n')
    scratch.joinpath('lib.rs').write_text('\n'.join(
        '#[path = ' + json.dumps(str(shell / 'src' / (name + '.rs'))) + ']\npub mod ' + name + ';'
        for name in ['config', 'framing', 'protocol', 'restart', 'supervisor']) + '\n')
    scratch.joinpath('src', 'bin').mkdir(parents=True)
    scratch.joinpath('src', 'bin', 'repro.rs').write_text(
        REPRO.replace('__FIXTURE__', str(shell / 'tests' / 'fake-sidecar.py')))
    env = dict(os.environ)
    env.setdefault('CARGO_TARGET_DIR', str(scratch / 'target'))
    for argv in ([], ['missing']):
        code = subprocess.call(['cargo', 'run', '--quiet', '--manifest-path',
                                str(scratch / 'Cargo.toml'), '--bin', 'repro', '--'] + argv, env=env)
        if code:
            raise SystemExit(code)
