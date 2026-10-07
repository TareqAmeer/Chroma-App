// Optional real-sensor regression, driven through the same payload entry as the Tauri command.
// Supply CHROMA_FILM_RAW_FIXTURE pointing to a local licensed RAW. This is stage/API validation,
// not a known-good negative conversion comparison: the RAW need not photograph film.
use super::*;
use tauri::ipc::{IpcResponse, InvokeResponseBody};

fn bytes(response: tauri::ipc::Response) -> Vec<u8> {
    match response.body().unwrap() { InvokeResponseBody::Raw(b) => b, _ => panic!("expected binary RAW response") }
}

#[test]
fn native_raw_sample_develop_disable_and_source_binding() {
    let path = match std::env::var("CHROMA_FILM_RAW_FIXTURE") {
        Ok(path) => path,
        Err(_) => { eprintln!("SKIP real RAW film gate: set CHROMA_FILM_RAW_FIXTURE"); return; }
    };
    let raw = std::fs::read(&path).unwrap();
    let plain = serde_json::json!({"mode":"srgb","rawNr":"off","autoLens":false,"demosaicAlgo":"","lensOverride":"","lensOverrideFocal":0,"fast":false});
    let started = std::time::Instant::now();
    let baseline = bytes(decode_raw_v2_payload(&plain, &raw).unwrap());
    let decoded = raw_decode::decode_rw2_bytes_film(&raw, false, raw_decode::NrTier::Off, "", false, None, 1.0, None, None, true).unwrap();
    let mut sample = None;
    for y in 1..10 { for x in 1..10 {
        let mut request = plain.clone(); request["mode"] = "sampleFilmBase".into(); request["nx"] = (x as f64 / 10.0).into(); request["ny"] = (y as f64 / 10.0).into();
        if let Ok(response) = decode_raw_v2_payload(&request, &raw) {
            sample = Some(serde_json::from_slice::<serde_json::Value>(&bytes(response)).unwrap()); break;
        }
    } if sample.is_some() { break; } }
    let sample = sample.expect("fixture must have one non-clipped uniform patch");
    let reference = [sample["rgb"][0].as_f64().unwrap(), sample["rgb"][1].as_f64().unwrap(), sample["rgb"][2].as_f64().unwrap()];
    let recipe = serde_json::json!({"domain":"camera-linear16-v1","sourceKey":sample["sourceKey"],"ref":reference,"exp":[2.04,1.5,1.29],"out":0.02,"bw":false});
    let mut request = plain.clone(); request["filmNegative"] = recipe;
    let developed = bytes(decode_raw_v2_payload(&request, &raw).unwrap());
    let expected_linear = film_negative::convert_rgb16(&decoded.rgb16, reference, [2.04,1.5,1.29], 0.02, false).unwrap();
    let expected_display = raw_decode::srgb_rgba(&expected_linear, decoded.xyz_to_cam);
    assert_eq!(&developed[24..], expected_display, "inverse response must precede native camera/display transform");
    assert_ne!(&developed[24..], &baseline[24..]);
    request["filmNegative"]["bw"] = true.into();
    let monochrome = bytes(decode_raw_v2_payload(&request, &raw).unwrap());
    assert!(monochrome[24..].chunks_exact(4).all(|p|p[0]==p[1]&&p[1]==p[2]));
    request["filmNegative"]["sourceKey"] = 0.into();
    assert!(decode_raw_v2_payload(&request, &raw).err().expect("stale source must fail").contains("pick native base"));
    assert_eq!(baseline, bytes(decode_raw_v2_payload(&plain, &raw).unwrap()), "disable must recover untouched decode, including default whitening");
    eprintln!("native RAW film gate: {}x{}, sample={}, elapsed_ms={}, max_stage_error=0, disabled_delta=0", decoded.width, decoded.height, sample, started.elapsed().as_millis());
}

#[test]
fn film_signature_binds_profile_and_source_without_binding_noise_tier() {
    let a=serde_json::json!({"lutKey":"profile-A","rawNr":"off"});
    let b=serde_json::json!({"lutKey":"profile-B","rawNr":"off"});
    let c=serde_json::json!({"lutKey":"profile-A","rawNr":"high"});
    assert_ne!(film_source_key(b"source",&a),film_source_key(b"source",&b));
    assert_ne!(film_source_key(b"source",&a),film_source_key(b"other",&a));
    assert_eq!(film_source_key(b"source",&a),film_source_key(b"source",&c));
}
