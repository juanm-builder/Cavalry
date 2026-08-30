use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

fn command_output(program: &str, arguments: &[&str]) -> String {
    let output = Command::new(program)
        .args(arguments)
        .output()
        .unwrap_or_else(|error| panic!("Could not run {program}: {error}"));
    if !output.status.success() {
        panic!(
            "{program} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    String::from_utf8(output.stdout)
        .expect("Tool output was not UTF-8.")
        .trim()
        .to_string()
}

fn swift_target(target: &str) -> &'static str {
    if target.starts_with("aarch64-") {
        "arm64-apple-macosx14.0"
    } else if target.starts_with("x86_64-") {
        "x86_64-apple-macosx14.0"
    } else {
        panic!("Cavalry for Mac does not support Rust target {target}.");
    }
}

fn compile_cloudkit_bridge() {
    let target = env::var("TARGET").expect("Cargo did not provide TARGET.");
    if !target.ends_with("apple-darwin") {
        panic!("Cavalry is Apple-only; unsupported target {target}.");
    }

    let manifest_dir = PathBuf::from(
        env::var("CARGO_MANIFEST_DIR").expect("Cargo did not provide CARGO_MANIFEST_DIR."),
    );
    let source_dir = manifest_dir.join("src/cloudkit");
    let store = source_dir.join("CavalryCloudKitStore.swift");
    let bridge = source_dir.join("CavalryCloudKitBridge.swift");
    let output_dir = PathBuf::from(env::var("OUT_DIR").expect("Cargo did not provide OUT_DIR."));
    let module_cache = output_dir.join("swift-module-cache");
    let library = output_dir.join("libCavalryCloudKit.a");
    fs::create_dir_all(&module_cache).expect("Could not create the Swift module cache.");

    let sdk = command_output("xcrun", &["--sdk", "macosx", "--show-sdk-path"]);
    let swiftc = command_output("xcrun", &["--find", "swiftc"]);
    let optimization = if env::var("PROFILE").as_deref() == Ok("release") {
        "-O"
    } else {
        "-Onone"
    };
    let status = Command::new(&swiftc)
        .args([
            "-parse-as-library",
            "-swift-version",
            "5",
            "-target",
            swift_target(&target),
            "-sdk",
            &sdk,
            optimization,
            "-module-cache-path",
        ])
        .arg(&module_cache)
        .args([
            "-emit-library",
            "-static",
            "-module-name",
            "CavalryCloudKit",
        ])
        .arg(&store)
        .arg(&bridge)
        .arg("-o")
        .arg(&library)
        .status()
        .expect("Could not launch the Swift compiler.");
    if !status.success() {
        panic!("The native Cavalry CloudKit bridge failed to compile.");
    }

    let swift_runtime = Path::new(&swiftc)
        .parent()
        .and_then(Path::parent)
        .map(|usr| usr.join("lib/swift/macosx"))
        .expect("Could not locate the Swift runtime libraries.");

    println!("cargo:rerun-if-changed={}", store.display());
    println!("cargo:rerun-if-changed={}", bridge.display());
    println!("cargo:rustc-link-search=native={}", output_dir.display());
    println!("cargo:rustc-link-search=native={}", swift_runtime.display());
    println!("cargo:rustc-link-search=native={sdk}/usr/lib/swift");
    // Unoptimized Swift links concurrency through @rpath, while optimized app
    // builds use the absolute system runtime path. Keep Rust test binaries
    // runnable without copying Apple's Swift runtime into the repository.
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    println!("cargo:rustc-link-lib=static=CavalryCloudKit");
    println!("cargo:rustc-link-lib=framework=CloudKit");
    println!("cargo:rustc-link-lib=framework=CryptoKit");
    println!("cargo:rustc-link-lib=framework=Foundation");
}

fn main() {
    compile_cloudkit_bridge();
    tauri_build::build();
}
