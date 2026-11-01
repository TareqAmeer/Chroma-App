#[path = "../src/inpaint.rs"]
mod inpaint;
#[path = "../src/platform/mod.rs"]
mod platform;
#[path = "../src/sam.rs"]
mod sam;
fn main() {
    let args: Vec<String> = std::env::args().collect();
    assert!(
        args.len() == 5 || args.len() == 9,
        "inpaint_probe <ORT dll/dylib> <model-directory> <photo> <output-directory> [mask-x0 mask-y0 mask-x1 mask-y1 (0..1000)]"
    );
    sam::set_dylib_path(args[1].clone().into());
    inpaint::set_root(args[2].clone().into());
    let rgb = image::open(&args[3]).unwrap().to_rgb8();
    let (w, h) = rgb.dimensions();
    let rect = if args.len() == 9 {
        let values: Vec<u32> = args[5..9]
            .iter()
            .map(|value| value.parse().expect("mask coordinates must be integers"))
            .collect();
        (values[0], values[1], values[2], values[3])
    } else {
        (300, 460, 330, 790)
    };
    assert!(rect.0 < rect.2 && rect.1 < rect.3 && rect.2 <= 1000 && rect.3 <= 1000);
    let x0 = w * rect.0 / 1000;
    let y0 = h * rect.1 / 1000;
    let x1 = w * rect.2 / 1000;
    let y1 = h * rect.3 / 1000;
    let mut mask = vec![255; w as usize * h as usize];
    for y in y0..y1 {
        for x in x0..x1 {
            mask[(y * w + x) as usize] = 0;
        }
    }
    let source_before = rgb.clone();
    let mut seen = Vec::new();
    let cancel = std::sync::atomic::AtomicBool::new(false);
    std::fs::create_dir_all(&args[4]).unwrap();
    let started = std::time::Instant::now();
    inpaint::generate(rgb.as_raw(),&mask,w,h,&cancel,|index,pixels|{
        let mut composite=source_before.clone();let mut changed=0;for i in 0..mask.len(){if pixels[i*4+3]>0{assert_eq!(mask[i],0);let x=(i%w as usize)as u32;let y=(i/w as usize)as u32;let p=image::Rgb([pixels[i*4],pixels[i*4+1],pixels[i*4+2]]);if composite.get_pixel(x,y)!=&p{changed+=1;}composite.put_pixel(x,y,p);}}
        let hash=blake3::hash(composite.as_raw()).to_string();assert!(!seen.contains(&hash));seen.push(hash.clone());assert!(changed>0);
        composite.save(std::path::Path::new(&args[4]).join(format!("candidate-{index}.png"))).map_err(|e|e.to_string())?;
        println!("candidate {index}: changed {changed} pixels, outside mask identical, hash {hash}, elapsed {:?}",started.elapsed());Ok(())
    }).expect("real native MI-GAN inference");
    assert_eq!(seen.len(), 3);
    println!(
        "PASS native MI-GAN CPU: three distinct mask-context candidates, source untouched, {:?}",
        started.elapsed()
    );
}
