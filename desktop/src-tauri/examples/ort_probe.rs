// Minimal diagnostic: does onnxruntime hang during environment init / Session::builder() even
// with NO model involved? Isolates "onnxruntime itself won't start on this machine" from
// "something about the SAM model files specifically".
fn main() {
    let dylib = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/onnxruntime/libonnxruntime.dylib");
    eprintln!("dylib path: {}", dylib.display());
    eprintln!("dylib exists: {}", dylib.exists());

    eprintln!("calling ort::init_from...");
    let builder = ort::init_from(&dylib).expect("init_from failed");
    eprintln!("init_from returned, calling commit()...");
    let ok = builder.commit();
    eprintln!("commit() returned: {ok}");

    eprintln!("calling Session::builder()...");
    let sess = ort::session::Session::builder();
    eprintln!("Session::builder() returned, ok={}", sess.is_ok());
}
