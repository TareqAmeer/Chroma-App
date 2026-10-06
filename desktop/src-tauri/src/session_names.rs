//! Portable folder-name validation for Session creation.

pub(crate) fn validate_name(name: &str) -> Result<&str, String> {
    if name.ends_with(' ') {
        return Err("Session name cannot end in a space".into());
    }
    let name = name.trim();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.ends_with('.')
        || !name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, ' ' | '-' | '_' | '.'))
    {
        return Err("Session name may contain letters, numbers, spaces, dots, dashes and underscores; it cannot end in a dot or space".into());
    }
    let reserved = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    if matches!(reserved.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            reserved.strip_prefix(prefix).is_some_and(|suffix| {
                suffix.len() == 1 && matches!(suffix.as_bytes()[0], b'1'..=b'9')
            })
        })
    {
        return Err("Session name is reserved by Windows".into());
    }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::validate_name;

    #[test]
    fn accepts_portable_names_and_rejects_traversal_or_windows_names() {
        assert_eq!(validate_name("Studio Shoot").unwrap(), "Studio Shoot");
        for name in [
            "",
            "..",
            "../escape",
            "C:",
            "CON",
            "bad/name",
            "trailing.",
            "trailing ",
        ] {
            assert!(
                validate_name(name).is_err(),
                "accepted unsafe name {name:?}"
            );
        }
    }
}
