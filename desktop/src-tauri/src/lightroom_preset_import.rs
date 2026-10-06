//! Read-only preview for Adobe Camera Raw / Lightroom XMP develop presets.
//!
//! This module only reads the XML text supplied by the UI. It does not access a catalog,
//! write a preset, or interpret legacy Lua templates. Camera Raw properties are identified by
//! their namespace URI (not a hard-coded XML prefix) and every develop property is classified.

use serde::Serialize;
use serde_json::{json, Map, Value};

const CAMERA_RAW_NS: &str = "http://ns.adobe.com/camera-raw-settings/1.0/";
const MAX_XMP_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SettingReport {
    pub property: String,
    pub value: String,
    pub status: String,
    pub target: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetPreview {
    pub name: String,
    pub recipe: Value,
    pub keys: Vec<String>,
    pub settings: Vec<SettingReport>,
    pub fidelity_note: String,
}

#[tauri::command]
pub fn preview_lightroom_xmp_preset(
    file_name: String,
    xml: String,
) -> Result<PresetPreview, String> {
    parse_xmp_preset(&file_name, &xml)
}

fn parse_xmp_preset(file_name: &str, xml: &str) -> Result<PresetPreview, String> {
    if xml.len() > MAX_XMP_BYTES {
        return Err("XMP preset exceeds the 2 MiB preview limit".into());
    }
    let doc = roxmltree::Document::parse(xml).map_err(|e| format!("Invalid XMP/XML: {e}"))?;
    let mut properties: Vec<(String, String)> = Vec::new();
    let mut preset_name: Option<String> = None;

    for node in doc.descendants().filter(|n| n.is_element()) {
        if let Some(tag) = node.tag_name().name().strip_prefix("crs:") {
            // Most preset packets use the Camera Raw namespace on rdf:Description attributes;
            // namespace URI checking below also handles alternate prefixes and child elements.
            if node.tag_name().namespace() == Some(CAMERA_RAW_NS) {
                let value = node.text().unwrap_or("").trim().to_owned();
                if tag == "Name" && !value.is_empty() {
                    preset_name = Some(value.clone());
                }
                properties.push((tag.to_owned(), value));
            }
        } else if node.tag_name().namespace() == Some(CAMERA_RAW_NS) {
            let tag = node.tag_name().name().to_owned();
            let value = node.text().unwrap_or("").trim().to_owned();
            if tag == "Name" && !value.is_empty() {
                preset_name = Some(value.clone());
            }
            properties.push((tag, value));
        }
        for attr in node
            .attributes()
            .filter(|a| a.namespace() == Some(CAMERA_RAW_NS))
        {
            let tag = attr.name().to_owned();
            let value = attr.value().trim().to_owned();
            if tag == "Name" && !value.is_empty() {
                preset_name = Some(value.clone());
            }
            properties.push((tag, value));
        }
    }
    if properties.is_empty() {
        return Err("No Camera Raw develop settings were found in this XMP file".into());
    }

    let ignored_metadata = [
        "Name",
        "PresetType",
        "Group",
        "UUID",
        "Cluster",
        "SupportsAmount",
        "SupportsColor",
        "SupportsMonochrome",
        "SupportsHighDynamicRange",
        "SupportsNormalDynamicRange",
        "CameraModelRestriction",
        "Copyright",
        "Contact",
        "Description",
        "Version",
        "ProcessVersion",
        "HasSettings",
        "AlreadyApplied",
        "Look",
        "ConvertToGrayscale",
    ];
    let mut sliders = Map::new();
    let mut keys = Vec::new();
    let mut settings = Vec::new();
    for (property, value) in properties {
        if ignored_metadata.contains(&property.as_str()) {
            continue;
        }
        if let Some((target, factor, note)) = mapping(&property) {
            let parsed = value.parse::<f64>().ok().filter(|n| n.is_finite());
            if let Some(number) = parsed {
                let converted = number * factor;
                if (-100.0..=100.0).contains(&converted) {
                    let text = if converted.fract() == 0.0 {
                        format!("{converted:.0}")
                    } else {
                        converted.to_string()
                    };
                    sliders.insert(target.to_owned(), Value::String(text));
                    let key = format!("slider:{target}");
                    if !keys.contains(&key) {
                        keys.push(key);
                    }
                    settings.push(SettingReport {
                        property,
                        value,
                        status: if note.is_some() {
                            "approximated"
                        } else {
                            "mapped"
                        }
                        .into(),
                        target: Some(target.into()),
                        note: note.map(str::to_owned),
                    });
                    continue;
                }
            }
            settings.push(SettingReport {
                property,
                value,
                status: "unsupported".into(),
                target: None,
                note: Some("Value is not a finite number within the target slider range".into()),
            });
        } else {
            settings.push(SettingReport {
                property,
                value: if value.is_empty() {
                    "(structured value)".into()
                } else {
                    value
                },
                status: "unsupported".into(),
                target: None,
                note: Some(
                    "No safe equivalent is implemented; this setting was not imported".into(),
                ),
            });
        }
    }
    if sliders.is_empty() {
        return Err(
            "The XMP contained develop settings, but none map to an available Chromasmith control"
                .into(),
        );
    }

    // Selectively applying these keys activates the app's Tone section and leaves unrelated
    // settings on the current photo untouched, matching the existing Style-import contract.
    let mut toggles = Map::new();
    toggles.insert("adjust".into(), json!(true));
    keys.push("toggle:adjust".into());
    let name = preset_name.unwrap_or_else(|| {
        file_name
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(file_name)
            .trim_end_matches(".xmp")
            .to_owned()
    });
    Ok(PresetPreview {
        name,
        recipe: json!({ "sliders": sliders, "toggles": toggles }),
        keys,
        settings,
        fidelity_note: "Develop values map to similarly named controls. Chromasmith's rendering algorithms differ from Lightroom, so matching slider numbers do not promise pixel-identical results.".into(),
    })
}

/// Returns the target slider, numeric scale conversion, and an approximation note when needed.
fn mapping(property: &str) -> Option<(&'static str, f64, Option<&'static str>)> {
    Some(match property {
        // Lightroom exposure is in EV; Chromasmith's current recipe schema is 20 points per EV.
        "Exposure2012" => ("adj-exp", 20.0, None),
        "Contrast2012" => (
            "adj-con",
            1.0,
            Some("Same nominal scale; contrast rendering differs."),
        ),
        "Highlights2012" => (
            "adj-hi",
            1.0,
            Some("Same nominal scale; highlight roll-off differs."),
        ),
        "Shadows2012" => (
            "adj-sh",
            1.0,
            Some("Same nominal scale; shadow rendering differs."),
        ),
        "Whites2012" => (
            "adj-wh",
            1.0,
            Some("Same nominal scale; white-point rendering differs."),
        ),
        "Blacks2012" => (
            "adj-bl",
            1.0,
            Some("Same nominal scale; black-point rendering differs."),
        ),
        "Vibrance" => (
            "adj-vib",
            1.0,
            Some("Same nominal scale; color rendering differs."),
        ),
        "Saturation" => (
            "adj-sat",
            1.0,
            Some("Same nominal scale; color rendering differs."),
        ),
        "Clarity2012" => (
            "adj-clarity",
            1.0,
            Some("The algorithms differ; treat as an approximation."),
        ),
        "Texture" => (
            "adj-texture",
            1.0,
            Some("The algorithms differ; treat as an approximation."),
        ),
        "Dehaze" => (
            "adj-dehaze",
            1.0,
            Some("The algorithms differ; treat as an approximation."),
        ),
        "Sharpness" => (
            "adj-sharp",
            1.0,
            Some("Sharpening algorithms and defaults differ."),
        ),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn previews_common_camera_raw_settings_and_reports_unsupported_values() {
        let xml = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"><rdf:RDF><rdf:Description crs:Name="Warm" crs:Exposure2012="1.25" crs:Contrast2012="12" crs:Temperature="5200"><crs:ToneCurvePV2012><rdf:Seq><rdf:li>0,0</rdf:li></rdf:Seq></crs:ToneCurvePV2012></rdf:Description></rdf:RDF></x:xmpmeta>"#;
        let p = parse_xmp_preset("fallback.xmp", xml).unwrap();
        assert_eq!(p.name, "Warm");
        assert_eq!(p.recipe["sliders"]["adj-exp"], "25");
        assert_eq!(p.recipe["sliders"]["adj-con"], "12");
        assert!(p
            .settings
            .iter()
            .any(|s| s.property == "Temperature" && s.status == "unsupported"));
        assert!(p
            .settings
            .iter()
            .any(|s| s.property == "ToneCurvePV2012" && s.status == "unsupported"));
    }

    #[test]
    fn resolves_camera_raw_namespace_without_requiring_the_crs_prefix() {
        let xml = r#"<packet xmlns:dev="http://ns.adobe.com/camera-raw-settings/1.0/"><Description dev:Exposure2012="-0.5"/></packet>"#;
        let p = parse_xmp_preset("p.xmp", xml).unwrap();
        assert_eq!(p.recipe["sliders"]["adj-exp"], "-10");
    }

    #[test]
    fn refuses_malformed_or_oversized_xmp() {
        assert!(parse_xmp_preset("bad.xmp", "<xmp>").is_err());
        assert!(parse_xmp_preset("large.xmp", &"x".repeat(MAX_XMP_BYTES + 1)).is_err());
    }
}
