use std::{env, fs, path::PathBuf};

fn main() {
    let input = "../playground/browser.rs";
    println!("cargo:rerun-if-changed={input}");
    let runtime = fs::read_to_string(input).expect("preview runtime");
    let (_, body) = runtime
        .split_once("include!(\"view.rs\");")
        .expect("runtime entry");
    fs::write(
        PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("runtime.rs"),
        body,
    )
    .expect("generated runtime");
}
