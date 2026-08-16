// Whether Core Image's own RAW decoder (CIRAWFilter) reports HDR headroom on a real RW2 — the
// question the RAW-headroom design depends on. Two candidate APIs, since Apple's docs are vague
// about which actually surfaces something for a Panasonic file:
//   1. CIRAWFilter's `extendedDynamicRangeAmount` output property.
//   2. Decoding via CIRAWFilter, then re-measuring headroom the SAME way source_headroom() does
//      (expand-to-HDR mean / plain mean) on the RESULT, in case the RAW filter's own linear
//      output already carries values above 1.0 that a normal CIImage load would clip.
#[cfg(target_os = "macos")]
#[path = "../src/gainmap.rs"]
mod gainmap;

#[cfg(target_os = "macos")]
fn main() {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::{NSDictionary, NSNumber, NSString, NSURL};
    let args: Vec<String> = std::env::args().skip(1).collect();
    for f in &args {
        unsafe {
            let url = NSURL::fileURLWithPath(&NSString::from_str(f));
            let filter_class = class!(CIRAWFilter);
            let filter: *mut AnyObject = msg_send![filter_class, filterWithImageURL: &*url];
            if filter.is_null() {
                println!("{f}: CIRAWFilter could not open this file");
                continue;
            }
            // extendedDynamicRangeAmount: 0 = SDR only, up to the filter's own max HDR amount.
            let edr: f64 = msg_send![filter, extendedDynamicRangeAmount];
            // Push it as far as it goes and read the decoded image's own headroom the same way
            // source_headroom measures a gain-map file.
            // Actual runtime class of what filterWithImageURL: handed back — CIRAWFilter often
            // returns a private concrete subclass, and if it's the WRONG one (e.g. a generic
            // CIFilter fallback because decode failed silently) that explains empty inputKeys.
            let cls: *mut AnyObject = msg_send![filter, class];
            let cls_name: Retained<NSString> = msg_send![cls, description];
            println!("  runtime class={cls_name}");
            // Dump every input/output key the filter itself claims to support — the ground truth,
            // rather than guessing selector names from documentation that may not match this SDK.
            let keys: *mut AnyObject = msg_send![filter, inputKeys];
            let keys_desc: Retained<NSString> = msg_send![keys, description];
            println!("  inputKeys={keys_desc}");
            let okeys: *mut AnyObject = msg_send![filter, outputKeys];
            let okeys_desc: Retained<NSString> = msg_send![okeys, description];
            println!("  outputKeys={okeys_desc}");
            let amt = NSNumber::new_f64(1.0);
            let _: () = msg_send![filter, setExtendedDynamicRangeAmount: &*amt];
            let out_img: *mut AnyObject = msg_send![filter, outputImage];
            let extent_str: Retained<NSString> = if out_img.is_null() {
                NSString::from_str("(no image)")
            } else {
                msg_send![out_img, description]
            };
            // And the SDR-amount (0) decode, to compare mean levels the same way source_headroom
            // does for a gain-map file.
            let zero = NSNumber::new_f64(0.0);
            let _: () = msg_send![filter, setExtendedDynamicRangeAmount: &*zero];
            let sdr_img: *mut AnyObject = msg_send![filter, outputImage];
            let (mean_sdr, mean_hdr) = if !sdr_img.is_null() && !out_img.is_null() {
                (gainmap::mean_level_pub_probe(sdr_img), gainmap::mean_level_pub_probe(out_img))
            } else { (Err("no image".into()), Err("no image".into())) };
            println!("{f}:  edr_default={edr:.4}  image={}\n    mean@0={:?}  mean@max={:?}",
                extent_str, mean_sdr, mean_hdr);
        }
    }
}
#[cfg(not(target_os = "macos"))]
fn main() { eprintln!("macOS only"); }
