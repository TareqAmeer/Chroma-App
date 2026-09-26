// Offline reverse geocoding: GPS lat/lon -> "City, County, Region, Country".
//
// Data: GeoNames cities15000 (CC-BY 4.0, https://www.geonames.org), trimmed at build time of this
// file to name / admin2 / admin1 / country / lat / lon (PPLX city-districts dropped so a photo in
// Camden still resolves through "Greater London"). Bundled with include_str! — no network, same
// fully-offline rule as the rest of the app. Lookup is a 1-degree grid bucket scan, so a whole
// library's metadata pass pays microseconds per photo, not a 30k-row linear scan each.
use std::collections::HashMap;
use std::sync::OnceLock;

const CITIES: &str = include_str!("cities.tsv");
/// Beyond this the nearest city is not "where the photo was taken" — say only the country.
const CITY_MAX_KM: f64 = 40.0;
const COUNTRY_MAX_KM: f64 = 250.0;

struct City {
    lat: f64,
    lon: f64,
    name: &'static str,
    admin2: &'static str,
    admin1: &'static str,
    country: &'static str,
}

fn index() -> &'static (Vec<City>, HashMap<(i32, i32), Vec<u32>>) {
    static IDX: OnceLock<(Vec<City>, HashMap<(i32, i32), Vec<u32>>)> = OnceLock::new();
    IDX.get_or_init(|| {
        let mut cities = Vec::new();
        let mut grid: HashMap<(i32, i32), Vec<u32>> = HashMap::new();
        for line in CITIES.lines() {
            let p: Vec<&str> = line.split('\t').collect();
            if p.len() < 6 { continue; }
            let (Ok(lat), Ok(lon)) = (p[4].parse::<f64>(), p[5].parse::<f64>()) else { continue };
            grid.entry((lat.floor() as i32, lon.floor() as i32)).or_default().push(cities.len() as u32);
            cities.push(City { lat, lon, name: p[0], admin2: p[1], admin1: p[2], country: p[3] });
        }
        (cities, grid)
    })
}

fn dist_km(a_lat: f64, a_lon: f64, b_lat: f64, b_lon: f64) -> f64 {
    let (p1, p2) = (a_lat.to_radians(), b_lat.to_radians());
    let dp = p2 - p1;
    let dl = (b_lon - a_lon).to_radians();
    let h = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    6371.0 * 2.0 * h.sqrt().asin()
}

/// "City, County, Region, Country" (empty parts skipped), or just the country when the nearest
/// city is far away, or None when nothing is within reach (mid-ocean, bad GPS).
pub fn place_for(lat: f64, lon: f64) -> Option<String> {
    if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) || (lat == 0.0 && lon == 0.0) {
        return None;
    }
    let (cities, grid) = index();
    let (cy, cx) = (lat.floor() as i32, lon.floor() as i32);
    let mut best: Option<(f64, &City)> = None;
    for dy in -3..=3 {
        for dx in -3..=3 {
            let mut gx = cx + dx;
            if gx < -180 { gx += 360; } else if gx >= 180 { gx -= 360; }
            let Some(ids) = grid.get(&(cy + dy, gx)) else { continue };
            for &i in ids {
                let c = &cities[i as usize];
                let d = dist_km(lat, lon, c.lat, c.lon);
                if best.map_or(true, |(bd, _)| d < bd) { best = Some((d, c)); }
            }
        }
    }
    let (d, c) = best?;
    if d > COUNTRY_MAX_KM { return None; }
    if d > CITY_MAX_KM { return Some(c.country.to_string()); }
    let parts: Vec<&str> = [c.name, c.admin2, c.admin1, c.country].into_iter().filter(|s| !s.is_empty()).collect();
    Some(parts.join(", "))
}

/// Degrees/minutes/seconds -> signed decimal degrees.
pub fn dms_to_deg(dms: [f64; 3], negative: bool) -> f64 {
    let v = dms[0] + dms[1] / 60.0 + dms[2] / 3600.0;
    if negative { -v } else { v }
}

/// GPS from a kamadak-exif parse (JPEG/HEIC/TIFF and TIFF-based RAWs).
pub fn gps_from_exif(exif: &exif::Exif) -> Option<(f64, f64)> {
    let dms = |tag| -> Option<[f64; 3]> {
        match &exif.get_field(tag, exif::In::PRIMARY)?.value {
            exif::Value::Rational(v) if v.len() >= 3 => Some([v[0].to_f64(), v[1].to_f64(), v[2].to_f64()]),
            _ => None,
        }
    };
    let rf = |tag| exif.get_field(tag, exif::In::PRIMARY).map(|f| f.display_value().to_string());
    let lat = dms(exif::Tag::GPSLatitude)?;
    let lon = dms(exif::Tag::GPSLongitude)?;
    let lat_s = rf(exif::Tag::GPSLatitudeRef).map_or(false, |s| s.contains('S'));
    let lon_w = rf(exif::Tag::GPSLongitudeRef).map_or(false, |s| s.contains('W'));
    let (la, lo) = (dms_to_deg(lat, lat_s), dms_to_deg(lon, lon_w));
    if la.is_finite() && lo.is_finite() && !(la == 0.0 && lo == 0.0) { Some((la, lo)) } else { None }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_london_and_its_boroughs() {
        let p = place_for(51.5007, -0.1246).unwrap(); // Westminster
        assert!(p.contains("London"), "{p}");
        let p = place_for(51.376, -0.098).unwrap(); // Croydon
        assert!(p.contains("Greater London"), "{p}");
        assert!(place_for(0.0, -30.0).is_none()); // mid-Atlantic
    }
}
