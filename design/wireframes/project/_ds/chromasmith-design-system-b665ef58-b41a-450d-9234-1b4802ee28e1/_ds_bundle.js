/* @ds-bundle: {"format":4,"namespace":"ChromasmithDesignSystem_b665ef","components":[{"name":"Button","sourcePath":"components/actions/Button.jsx"},{"name":"IconButton","sourcePath":"components/actions/IconButton.jsx"},{"name":"TextLink","sourcePath":"components/actions/TextLink.jsx"},{"name":"OptionChip","sourcePath":"components/forms/OptionChip.jsx"},{"name":"SearchInput","sourcePath":"components/forms/SearchInput.jsx"},{"name":"Footer","sourcePath":"components/navigation/Footer.jsx"},{"name":"GlobalNav","sourcePath":"components/navigation/GlobalNav.jsx"},{"name":"SubNav","sourcePath":"components/navigation/SubNav.jsx"},{"name":"ProductTile","sourcePath":"components/surfaces/ProductTile.jsx"},{"name":"QuoteCard","sourcePath":"components/surfaces/QuoteCard.jsx"},{"name":"StickyBar","sourcePath":"components/surfaces/StickyBar.jsx"},{"name":"UtilityCard","sourcePath":"components/surfaces/UtilityCard.jsx"}],"sourceHashes":{"components/actions/Button.jsx":"48ba42b58cd1","components/actions/IconButton.jsx":"79a0511df0a9","components/actions/TextLink.jsx":"504d3c911f18","components/forms/OptionChip.jsx":"d1f587666d44","components/forms/SearchInput.jsx":"5b2e699cb408","components/navigation/Footer.jsx":"565c29df91f8","components/navigation/GlobalNav.jsx":"c3a77291033e","components/navigation/SubNav.jsx":"b4a6720e2bf6","components/surfaces/ProductTile.jsx":"4b2e70838ed7","components/surfaces/QuoteCard.jsx":"ece50d0a6f44","components/surfaces/StickyBar.jsx":"f06e87562d04","components/surfaces/UtilityCard.jsx":"50944d17b985","ui_kits/_shared/Placeholders.jsx":"5f138212edc7","ui_kits/chromasmith-app/App.jsx":"dc7c1e88bb7a","ui_kits/chromasmith-app/EditorScreen.jsx":"06513f74d370","ui_kits/chromasmith-app/LibraryScreen.jsx":"8d2eed11381a","ui_kits/chromasmith-app/PacksScreen.jsx":"1248613d5c42","ui_kits/chromasmith-web/HomePage.jsx":"2aa0493ec58b","ui_kits/chromasmith-web/PacksPage.jsx":"9e44abefb3ea","ui_kits/chromasmith-web/PricingPage.jsx":"334b2a364cbe","ui_kits/chromasmith-web/Site.jsx":"99337211f78e"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.ChromasmithDesignSystem_b665ef = window.ChromasmithDesignSystem_b665ef || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/actions/Button.jsx
try { (() => {
const V = {
  primary: {
    background: 'var(--primary)',
    color: 'var(--on-primary)',
    border: '1px solid transparent',
    borderRadius: 'var(--radius-pill)',
    padding: '11px 22px',
    fontSize: 'var(--type-body-size)',
    fontWeight: 'var(--type-body-weight)',
    lineHeight: 1.2,
    letterSpacing: 'var(--type-body-ls)'
  },
  secondaryPill: {
    background: 'transparent',
    color: 'var(--primary)',
    border: '1px solid var(--primary)',
    borderRadius: 'var(--radius-pill)',
    padding: '11px 22px',
    fontSize: 'var(--type-body-size)',
    fontWeight: 'var(--type-body-weight)',
    lineHeight: 1.2,
    letterSpacing: 'var(--type-body-ls)'
  },
  darkUtility: {
    background: 'var(--ink)',
    color: 'var(--on-dark)',
    border: '1px solid transparent',
    borderRadius: 'var(--radius-sm)',
    padding: '8px 15px',
    fontSize: 'var(--type-button-utility-size)',
    fontWeight: 'var(--type-button-utility-weight)',
    lineHeight: 'var(--type-button-utility-lh)',
    letterSpacing: 'var(--type-button-utility-ls)'
  },
  pearlCapsule: {
    background: 'var(--surface-pearl)',
    color: 'var(--ink-muted-80)',
    border: '3px solid var(--divider-soft)',
    borderRadius: 'var(--radius-md)',
    padding: '8px 14px',
    fontSize: 'var(--type-caption-size)',
    fontWeight: 'var(--type-caption-weight)',
    lineHeight: 'var(--type-caption-lh)',
    letterSpacing: 'var(--type-caption-ls)'
  },
  storeHero: {
    background: 'var(--primary)',
    color: 'var(--on-primary)',
    border: '1px solid transparent',
    borderRadius: 'var(--radius-pill)',
    padding: '14px 28px',
    fontSize: 'var(--type-button-large-size)',
    fontWeight: 'var(--type-button-large-weight)',
    lineHeight: 'var(--type-button-large-lh)',
    letterSpacing: 'var(--type-button-large-ls)'
  }
};
function Button({
  variant = 'primary',
  onDark = false,
  disabled = false,
  fullWidth = false,
  as = 'button',
  href,
  children,
  style,
  ...rest
}) {
  const [pressed, setPressed] = React.useState(false);
  const base = V[variant] || V.primary;
  const dark = onDark && variant === 'secondaryPill' ? {
    color: 'var(--primary-on-dark)',
    borderColor: 'var(--primary-on-dark)'
  } : null;
  const Tag = as === 'a' ? 'a' : 'button';
  return React.createElement(Tag, {
    href: Tag === 'a' ? href : undefined,
    disabled: Tag === 'button' ? disabled : undefined,
    onPointerDown: () => setPressed(true),
    onPointerUp: () => setPressed(false),
    onPointerLeave: () => setPressed(false),
    style: {
      ...base,
      ...dark,
      fontFamily: 'var(--font-text)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      width: fullWidth ? '100%' : undefined,
      cursor: disabled ? 'default' : 'pointer',
      textDecoration: 'none',
      opacity: disabled ? 1 : 1,
      ...(disabled ? {
        background: variant === 'secondaryPill' ? 'transparent' : 'var(--divider-soft)',
        color: 'var(--ink-muted-48)',
        borderColor: variant === 'secondaryPill' ? 'var(--hairline)' : 'transparent'
      } : null),
      transform: pressed && !disabled ? 'scale(var(--press-scale))' : 'scale(1)',
      transition: 'transform var(--duration-press) var(--ease-standard)',
      ...style
    },
    ...rest
  }, children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/Button.jsx", error: String((e && e.message) || e) }); }

// components/actions/IconButton.jsx
try { (() => {
function IconButton({
  variant = 'translucent',
  size = 44,
  label,
  children,
  style,
  ...rest
}) {
  const [pressed, setPressed] = React.useState(false);
  const skins = {
    translucent: {
      background: 'var(--surface-chip-alpha)',
      color: 'var(--ink)',
      border: 'none'
    },
    dark: {
      background: 'var(--ink)',
      color: 'var(--on-dark)',
      border: 'none'
    },
    plain: {
      background: 'transparent',
      color: 'var(--ink)',
      border: 'none'
    },
    plainOnDark: {
      background: 'transparent',
      color: 'var(--on-dark)',
      border: 'none'
    },
    outline: {
      background: 'var(--canvas)',
      color: 'var(--ink)',
      border: '1px solid var(--hairline)'
    }
  };
  return React.createElement('button', {
    'aria-label': label,
    onPointerDown: () => setPressed(true),
    onPointerUp: () => setPressed(false),
    onPointerLeave: () => setPressed(false),
    style: {
      ...skins[variant],
      width: size,
      height: size,
      minWidth: size,
      borderRadius: 'var(--radius-full)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      padding: 0,
      transform: pressed ? 'scale(var(--press-scale))' : 'scale(1)',
      transition: 'transform var(--duration-press) var(--ease-standard)',
      ...style
    },
    ...rest
  }, children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/actions/TextLink.jsx
try { (() => {
function TextLink({
  onDark = false,
  underline = false,
  size = 'body',
  children,
  style,
  ...rest
}) {
  const sizes = {
    body: {
      fontSize: 'var(--type-body-size)',
      lineHeight: 'var(--type-body-lh)',
      letterSpacing: 'var(--type-body-ls)'
    },
    caption: {
      fontSize: 'var(--type-caption-size)',
      lineHeight: 'var(--type-caption-lh)',
      letterSpacing: 'var(--type-caption-ls)'
    },
    dense: {
      fontSize: 'var(--type-dense-link-size)',
      lineHeight: 'var(--type-dense-link-lh)',
      letterSpacing: 'var(--type-dense-link-ls)'
    }
  };
  return React.createElement('a', {
    style: {
      fontFamily: 'var(--font-text)',
      fontWeight: 'var(--weight-regular)',
      color: onDark ? 'var(--text-link-on-dark)' : 'var(--text-link)',
      textDecoration: underline ? 'underline' : 'none',
      ...sizes[size],
      ...style
    },
    ...rest
  }, children);
}
Object.assign(__ds_scope, { TextLink });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/TextLink.jsx", error: String((e && e.message) || e) }); }

// components/forms/OptionChip.jsx
try { (() => {
function OptionChip({
  label,
  detail,
  thumb,
  selected = false,
  disabled = false,
  onDark = false,
  onClick,
  style,
  ...rest
}) {
  const [pressed, setPressed] = React.useState(false);
  return React.createElement('button', {
    onClick: disabled ? undefined : onClick,
    onPointerDown: () => setPressed(true),
    onPointerUp: () => setPressed(false),
    onPointerLeave: () => setPressed(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--space-xs)',
      background: onDark ? 'rgba(255,255,255,.06)' : 'var(--canvas)',
      color: disabled ? 'var(--ink-muted-48)' : onDark ? 'var(--on-dark)' : 'var(--ink)',
      border: selected ? '2px solid ' + (onDark ? 'var(--primary-on-dark)' : 'var(--primary-focus)') : '1px solid ' + (onDark ? 'rgba(255,255,255,.16)' : 'var(--hairline)'),
      padding: selected ? '11px 15px' : '12px 16px',
      borderRadius: 'var(--radius-pill)',
      fontFamily: 'var(--font-text)',
      fontSize: 'var(--type-caption-size)',
      lineHeight: 'var(--type-caption-lh)',
      letterSpacing: 'var(--type-caption-ls)',
      cursor: disabled ? 'default' : 'pointer',
      transform: pressed && !disabled ? 'scale(var(--press-scale))' : 'scale(1)',
      transition: 'transform var(--duration-press) var(--ease-standard)',
      ...style
    },
    ...rest
  }, thumb && React.createElement('span', {
    style: {
      width: '20px',
      height: '20px',
      borderRadius: 'var(--radius-full)',
      overflow: 'hidden',
      lineHeight: 0,
      flex: 'none'
    }
  }, thumb), React.createElement('span', {
    style: {
      fontWeight: selected ? 'var(--weight-semibold)' : 'var(--weight-regular)'
    }
  }, label), detail && React.createElement('span', {
    style: {
      color: onDark ? 'var(--text-on-dark-muted)' : 'var(--ink-muted-48)'
    }
  }, detail));
}
Object.assign(__ds_scope, { OptionChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/OptionChip.jsx", error: String((e && e.message) || e) }); }

// components/forms/SearchInput.jsx
try { (() => {
function SearchInput({
  placeholder = 'Search presets',
  icon,
  value,
  onChange,
  onDark = false,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  return React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-xs)',
      background: onDark ? 'rgba(255,255,255,.08)' : 'var(--canvas)',
      border: '1px solid ' + (onDark ? 'rgba(255,255,255,.14)' : 'var(--hairline-alpha)'),
      borderRadius: 'var(--radius-pill)',
      height: 'var(--height-input)',
      padding: '0 20px',
      boxShadow: focus ? 'var(--focus-ring)' : 'none',
      ...style
    }
  }, icon && React.createElement('span', {
    style: {
      display: 'flex',
      color: onDark ? 'var(--text-on-dark-muted)' : 'var(--ink-muted-48)',
      lineHeight: 0
    }
  }, icon), React.createElement('input', {
    value,
    onChange,
    placeholder,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      border: 'none',
      outline: 'none',
      background: 'transparent',
      flex: 1,
      minWidth: 0,
      color: onDark ? 'var(--on-dark)' : 'var(--ink)',
      fontFamily: 'var(--font-text)',
      fontSize: 'var(--type-body-size)',
      fontWeight: 'var(--type-body-weight)',
      letterSpacing: 'var(--type-body-ls)'
    },
    ...rest
  }));
}
Object.assign(__ds_scope, { SearchInput });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SearchInput.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Footer.jsx
try { (() => {
function Footer({
  columns = [],
  legal = 'Copyright © 2026 Chromasmith Inc. All rights reserved.',
  note,
  style,
  ...rest
}) {
  return React.createElement('footer', {
    style: {
      background: 'var(--canvas-parchment)',
      color: 'var(--ink-muted-80)',
      padding: 'var(--pad-footer) 22px',
      fontFamily: 'var(--font-text)',
      ...style
    },
    ...rest
  }, React.createElement('div', {
    style: {
      maxWidth: 'var(--container-grid)',
      margin: '0 auto'
    }
  }, note && React.createElement('p', {
    style: {
      fontSize: 'var(--type-fine-print-size)',
      lineHeight: 1.5,
      letterSpacing: 'var(--type-fine-print-ls)',
      color: 'var(--ink-muted-48)',
      maxWidth: '700px',
      margin: '0 0 32px'
    }
  }, note), React.createElement('div', {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))',
      gap: '0 var(--space-xl)'
    }
  }, columns.map((c, i) => React.createElement('div', {
    key: i
  }, React.createElement('div', {
    style: {
      fontSize: 'var(--type-caption-strong-size)',
      fontWeight: 'var(--type-caption-strong-weight)',
      lineHeight: 'var(--type-caption-strong-lh)',
      letterSpacing: 'var(--type-caption-strong-ls)',
      color: 'var(--ink)',
      marginBottom: '8px'
    }
  }, c.heading), c.links.map((l, j) => React.createElement('a', {
    key: j,
    href: '#',
    style: {
      display: 'block',
      fontSize: 'var(--type-fine-print-size)',
      lineHeight: 2.2,
      letterSpacing: 'var(--type-fine-print-ls)',
      color: 'var(--ink-muted-80)',
      textDecoration: 'none'
    }
  }, l))))), React.createElement('div', {
    style: {
      borderTop: '1px solid var(--hairline)',
      marginTop: 'var(--space-xl)',
      paddingTop: 'var(--space-md)',
      fontSize: 'var(--type-micro-legal-size)',
      lineHeight: 'var(--type-micro-legal-lh)',
      letterSpacing: 'var(--type-micro-legal-ls)',
      color: 'var(--ink-muted-48)'
    }
  }, legal)));
}
Object.assign(__ds_scope, { Footer });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Footer.jsx", error: String((e && e.message) || e) }); }

// components/navigation/GlobalNav.jsx
try { (() => {
function GlobalNav({
  brand = 'Chromasmith',
  links = [],
  right,
  style,
  ...rest
}) {
  return React.createElement('nav', {
    style: {
      background: 'var(--surface-black)',
      color: 'var(--on-dark)',
      height: 'var(--height-global-nav)',
      display: 'flex',
      alignItems: 'center',
      gap: '20px',
      padding: '0 22px',
      fontFamily: 'var(--font-text)',
      fontSize: 'var(--type-nav-link-size)',
      fontWeight: 'var(--type-nav-link-weight)',
      letterSpacing: 'var(--type-nav-link-ls)',
      ...style
    },
    ...rest
  }, React.createElement('span', {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 'var(--weight-semibold)',
      fontSize: '13px',
      letterSpacing: '-0.2px',
      marginRight: '8px'
    }
  }, brand), links.map((l, i) => React.createElement('a', {
    key: i,
    href: l.href || '#',
    onClick: l.onClick,
    style: {
      color: 'var(--on-dark)',
      opacity: l.active ? 1 : .82,
      textDecoration: 'none',
      cursor: 'pointer',
      whiteSpace: 'nowrap'
    }
  }, l.label)), React.createElement('span', {
    style: {
      flex: 1
    }
  }), right);
}
Object.assign(__ds_scope, { GlobalNav });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/GlobalNav.jsx", error: String((e && e.message) || e) }); }

// components/navigation/SubNav.jsx
try { (() => {
function SubNav({
  title = 'Presets',
  links = [],
  cta,
  onDark = false,
  style,
  ...rest
}) {
  return React.createElement('div', {
    style: {
      background: onDark ? 'var(--frosted-fill-dark)' : 'var(--frosted-fill)',
      backdropFilter: 'var(--blur-frosted)',
      WebkitBackdropFilter: 'var(--blur-frosted)',
      borderBottom: '1px solid var(--hairline-alpha)',
      height: 'var(--height-sub-nav)',
      display: 'flex',
      alignItems: 'center',
      gap: '24px',
      padding: '0 22px',
      color: onDark ? 'var(--on-dark)' : 'var(--ink)',
      ...style
    },
    ...rest
  }, React.createElement('span', {
    style: {
      fontFamily: 'var(--font-display)',
      fontSize: 'var(--type-tagline-size)',
      fontWeight: 'var(--type-tagline-weight)',
      lineHeight: 'var(--type-tagline-lh)',
      letterSpacing: 'var(--type-tagline-ls)'
    }
  }, title), React.createElement('span', {
    style: {
      flex: 1
    }
  }), React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '22px'
    }
  }, links.map((l, i) => React.createElement('a', {
    key: i,
    href: l.href || '#',
    onClick: l.onClick,
    style: {
      fontFamily: 'var(--font-text)',
      fontSize: 'var(--type-button-utility-size)',
      fontWeight: 'var(--type-button-utility-weight)',
      letterSpacing: 'var(--type-button-utility-ls)',
      color: onDark ? 'var(--on-dark)' : 'var(--ink)',
      opacity: l.active ? 1 : .78,
      textDecoration: 'none',
      cursor: 'pointer',
      whiteSpace: 'nowrap'
    }
  }, l.label)), cta));
}
Object.assign(__ds_scope, { SubNav });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/SubNav.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/ProductTile.jsx
try { (() => {
const SURF = {
  light: {
    background: 'var(--canvas)',
    color: 'var(--ink)'
  },
  parchment: {
    background: 'var(--canvas-parchment)',
    color: 'var(--ink)'
  },
  linen: {
    background: 'var(--canvas-linen)',
    color: 'var(--ink)'
  },
  dark: {
    background: 'var(--surface-tile-1)',
    color: 'var(--on-dark)'
  },
  dark2: {
    background: 'var(--surface-tile-2)',
    color: 'var(--on-dark)'
  },
  dark3: {
    background: 'var(--surface-tile-3)',
    color: 'var(--on-dark)'
  }
};
function ProductTile({
  surface = 'light',
  eyebrow,
  title,
  tagline,
  actions,
  media,
  align = 'center',
  tight = false,
  children,
  style,
  ...rest
}) {
  const s = SURF[surface] || SURF.light;
  const dark = surface.startsWith('dark');
  return React.createElement('section', {
    style: {
      ...s,
      borderRadius: 'var(--radius-tile)',
      padding: (tight ? 'var(--pad-tile-tight)' : 'var(--pad-tile)') + ' 22px',
      textAlign: align,
      display: 'flex',
      flexDirection: 'column',
      alignItems: align === 'center' ? 'center' : 'flex-start',
      gap: 'var(--space-md)',
      ...style
    },
    ...rest
  }, eyebrow && React.createElement('div', {
    style: {
      fontFamily: 'var(--font-text)',
      fontSize: 'var(--type-caption-strong-size)',
      fontWeight: 'var(--type-caption-strong-weight)',
      letterSpacing: 'var(--type-caption-strong-ls)',
      color: dark ? 'var(--primary-on-dark)' : 'var(--primary)',
      margin: 0
    }
  }, eyebrow), title && React.createElement('h2', {
    style: {
      fontFamily: 'var(--font-display)',
      fontSize: 'var(--type-display-lg-size)',
      fontWeight: 'var(--type-display-lg-weight)',
      lineHeight: 'var(--type-display-lg-lh)',
      letterSpacing: 'var(--type-display-lg-ls)',
      margin: 0,
      maxWidth: '18ch',
      textWrap: 'pretty'
    }
  }, title), tagline && React.createElement('p', {
    style: {
      fontFamily: 'var(--font-display)',
      fontSize: 'var(--type-lead-size)',
      fontWeight: 'var(--type-lead-weight)',
      lineHeight: 'var(--type-lead-lh)',
      letterSpacing: 'var(--type-lead-ls)',
      color: dark ? 'var(--text-on-dark-muted)' : 'var(--ink-muted-80)',
      margin: 0,
      maxWidth: '34ch',
      textWrap: 'pretty'
    }
  }, tagline), actions && React.createElement('div', {
    style: {
      display: 'flex',
      gap: 'var(--space-md)',
      flexWrap: 'wrap',
      justifyContent: align === 'center' ? 'center' : 'flex-start',
      marginTop: 'var(--space-xs)'
    }
  }, actions), children, media && React.createElement('div', {
    style: {
      marginTop: 'var(--space-xxl)',
      boxShadow: 'var(--shadow-product)',
      lineHeight: 0,
      maxWidth: '100%'
    }
  }, media));
}
Object.assign(__ds_scope, { ProductTile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/ProductTile.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/QuoteCard.jsx
try { (() => {
function QuoteCard({
  kicker,
  quote,
  attribution,
  action,
  image,
  style,
  ...rest
}) {
  return React.createElement('section', {
    style: {
      background: 'var(--surface-tile-1)',
      color: 'var(--on-dark)',
      borderRadius: 'var(--radius-none)',
      padding: 'var(--pad-tile) 22px',
      textAlign: 'center',
      position: 'relative',
      overflow: 'hidden',
      backgroundImage: image ? 'linear-gradient(rgba(39,39,41,.55),rgba(39,39,41,.55)), url(' + image + ')' : undefined,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      ...style
    },
    ...rest
  }, React.createElement('div', {
    style: {
      maxWidth: 'var(--container-text)',
      margin: '0 auto',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 'var(--space-lg)'
    }
  }, kicker && React.createElement('div', {
    style: {
      fontFamily: 'var(--font-text)',
      fontSize: 'var(--type-caption-strong-size)',
      fontWeight: 'var(--type-caption-strong-weight)',
      letterSpacing: '.06em',
      textTransform: 'uppercase',
      color: 'var(--primary-on-dark)'
    }
  }, kicker), React.createElement('blockquote', {
    style: {
      fontFamily: 'var(--font-display)',
      fontSize: 'var(--type-display-lg-size)',
      fontWeight: 'var(--type-display-lg-weight)',
      lineHeight: 'var(--type-display-lg-lh)',
      letterSpacing: 'var(--type-display-lg-ls)',
      margin: 0,
      textWrap: 'pretty'
    }
  }, quote), attribution && React.createElement('div', {
    style: {
      fontFamily: 'var(--font-text)',
      fontSize: 'var(--type-lead-airy-size)',
      fontWeight: 'var(--type-lead-airy-weight)',
      lineHeight: 'var(--type-lead-airy-lh)',
      color: 'var(--text-on-dark-muted)'
    }
  }, attribution), action));
}
Object.assign(__ds_scope, { QuoteCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/QuoteCard.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/StickyBar.jsx
try { (() => {
function StickyBar({
  label,
  detail,
  actions,
  onDark = false,
  style,
  ...rest
}) {
  return React.createElement('div', {
    style: {
      background: onDark ? 'var(--frosted-fill-dark)' : 'var(--frosted-fill)',
      backdropFilter: 'var(--blur-frosted)',
      WebkitBackdropFilter: 'var(--blur-frosted)',
      color: onDark ? 'var(--on-dark)' : 'var(--ink)',
      minHeight: 'var(--height-sticky-bar)',
      padding: '12px var(--space-xl)',
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-lg)',
      borderTop: '1px solid var(--hairline-alpha)',
      fontFamily: 'var(--font-text)',
      ...style
    },
    ...rest
  }, React.createElement('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      minWidth: 0
    }
  }, React.createElement('span', {
    style: {
      fontSize: 'var(--type-body-strong-size)',
      fontWeight: 'var(--type-body-strong-weight)',
      letterSpacing: 'var(--type-body-strong-ls)'
    }
  }, label), detail && React.createElement('span', {
    style: {
      fontSize: 'var(--type-caption-size)',
      letterSpacing: 'var(--type-caption-ls)',
      color: onDark ? 'var(--text-on-dark-muted)' : 'var(--ink-muted-48)'
    }
  }, detail)), React.createElement('span', {
    style: {
      flex: 1
    }
  }), React.createElement('div', {
    style: {
      display: 'flex',
      gap: 'var(--space-sm)',
      alignItems: 'center'
    }
  }, actions));
}
Object.assign(__ds_scope, { StickyBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/StickyBar.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/UtilityCard.jsx
try { (() => {
function UtilityCard({
  image,
  title,
  meta,
  price,
  action,
  badge,
  children,
  style,
  ...rest
}) {
  return React.createElement('div', {
    style: {
      background: 'var(--surface-card)',
      color: 'var(--ink)',
      border: '1px solid var(--border-card)',
      borderRadius: 'var(--radius-card)',
      padding: 'var(--pad-card)',
      fontFamily: 'var(--font-text)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-sm)',
      ...style
    },
    ...rest
  }, image && React.createElement('div', {
    style: {
      borderRadius: 'var(--radius-image-inline)',
      overflow: 'hidden',
      aspectRatio: '1/1',
      background: 'var(--canvas-parchment)',
      lineHeight: 0,
      position: 'relative'
    }
  }, image, badge && React.createElement('span', {
    style: {
      position: 'absolute',
      top: '8px',
      left: '8px',
      background: 'var(--state-warning)',
      color: 'var(--ink)',
      fontSize: 'var(--type-micro-legal-size)',
      fontWeight: 'var(--weight-semibold)',
      letterSpacing: '.02em',
      textTransform: 'uppercase',
      padding: '3px 7px',
      borderRadius: 'var(--radius-xs)'
    }
  }, badge)), title && React.createElement('div', {
    style: {
      fontSize: 'var(--type-body-strong-size)',
      fontWeight: 'var(--type-body-strong-weight)',
      lineHeight: 'var(--type-body-strong-lh)',
      letterSpacing: 'var(--type-body-strong-ls)'
    }
  }, title), meta && React.createElement('div', {
    style: {
      fontSize: 'var(--type-caption-size)',
      lineHeight: 'var(--type-caption-lh)',
      letterSpacing: 'var(--type-caption-ls)',
      color: 'var(--ink-muted-48)'
    }
  }, meta), price && React.createElement('div', {
    style: {
      fontSize: 'var(--type-body-size)',
      lineHeight: 'var(--type-body-lh)',
      letterSpacing: 'var(--type-body-ls)'
    }
  }, price), children, action && React.createElement('div', {
    style: {
      marginTop: 'auto',
      paddingTop: 'var(--space-xs)'
    }
  }, action));
}
Object.assign(__ds_scope, { UtilityCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/UtilityCard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/_shared/Placeholders.jsx
try { (() => {
// Placeholder imagery. No photography shipped with this design system —
// every frame here is a flat token-coloured plate with a dashed edge so it
// reads unambiguously as "photo goes here". Never replace with a gradient.
const PLATE = ['#2f3b42', '#3d4a4f', '#514a44', '#61a0af', '#8a7f74', '#272729', '#4a5a63', '#7a6a5c', '#224455', '#5f6b5c', '#8a5a4a', '#3a3f4a'];
function Photo({
  i = 0,
  ratio = '1/1',
  label,
  radius = '0px',
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      aspectRatio: ratio,
      background: PLATE[i % PLATE.length],
      borderRadius: radius,
      position: 'relative',
      overflow: 'hidden',
      outline: '1px dashed rgba(255,255,255,.22)',
      outlineOffset: '-1px',
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      bottom: '6px',
      left: '8px',
      fontFamily: 'var(--font-text)',
      fontSize: '10px',
      letterSpacing: '-.08px',
      color: 'rgba(255,255,255,.7)'
    }
  }, label));
}
const Icon = ({
  n,
  size = 16,
  inv = false,
  op = 1
}) => /*#__PURE__*/React.createElement("img", {
  src: "https://unpkg.com/lucide-static@0.544.0/icons/" + n + ".svg",
  width: size,
  height: size,
  alt: "",
  style: {
    filter: inv ? "brightness(0) invert(1)" : "none",
    opacity: op,
    display: 'block'
  }
});
Object.assign(window, {
  Photo,
  Icon,
  PLATE
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/_shared/Placeholders.jsx", error: String((e && e.message) || e) }); }

// ui_kits/chromasmith-app/App.jsx
try { (() => {
const {
  GlobalNav,
  SubNav,
  Button,
  IconButton
} = window.ChromasmithDesignSystem_b665ef;
function App() {
  const [screen, setScreen] = React.useState('library');
  const TABS = [['library', 'Library'], ['editor', 'Develop'], ['packs', 'Film Packs']];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(GlobalNav, {
    brand: "Chromasmith",
    links: TABS.map(([k, l]) => ({
      label: l,
      active: screen === k,
      onClick: () => setScreen(k)
    })),
    right: /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '4px',
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement(IconButton, {
      label: "Sync",
      variant: "plainOnDark",
      size: 26
    }, /*#__PURE__*/React.createElement(Icon, {
      n: "refresh-cw",
      size: 14,
      inv: true,
      op: .8
    })), /*#__PURE__*/React.createElement(IconButton, {
      label: "Account",
      variant: "plainOnDark",
      size: 26
    }, /*#__PURE__*/React.createElement(Icon, {
      n: "user-round",
      size: 14,
      inv: true,
      op: .8
    })))
  }), /*#__PURE__*/React.createElement(SubNav, {
    onDark: screen !== 'packs',
    title: screen === 'packs' ? 'Film Packs' : screen === 'editor' ? 'Develop' : 'Library',
    links: [{
      label: 'All photos',
      active: screen === 'library'
    }, {
      label: 'Albums'
    }, {
      label: 'Presets'
    }],
    cta: /*#__PURE__*/React.createElement(Button, {
      style: {
        padding: '6px 15px',
        fontSize: 'var(--type-caption-size)'
      },
      onClick: () => setScreen('packs')
    }, "Get Pro")
  }), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      minHeight: 0
    }
  }, screen === 'library' && /*#__PURE__*/React.createElement(LibraryScreen, {
    onOpenPhoto: () => setScreen('editor'),
    onNav: setScreen
  }), screen === 'editor' && /*#__PURE__*/React.createElement(EditorScreen, {
    onBack: () => setScreen('library')
  }), screen === 'packs' && /*#__PURE__*/React.createElement(PacksScreen, null)));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/chromasmith-app/App.jsx", error: String((e && e.message) || e) }); }

// ui_kits/chromasmith-app/EditorScreen.jsx
try { (() => {
const {
  IconButton,
  Button,
  OptionChip,
  StickyBar,
  TextLink
} = window.ChromasmithDesignSystem_b665ef;
const SLIDERS = [['Exposure', 0.3], ['Contrast', -0.15], ['Halation', 0.55], ['Grain', 0.72], ['Warmth', 0.4], ['Shadow roll-off', 0.22]];
const STOCKS = [['Portra 400', '#8a7f74'], ['Ektar 100', '#8a5a4a'], ['Tri-X 400', '#3d4a4f'], ['Cinestill 800T', '#224455'], ['Velvia 50', '#5f6b5c']];
function Slider({
  label,
  v
}) {
  const [val, setVal] = React.useState(v);
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'block'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: 'var(--type-caption-size)',
      letterSpacing: 'var(--type-caption-ls)',
      marginBottom: '6px'
    }
  }, /*#__PURE__*/React.createElement("span", null, label), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-on-dark-muted)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, (val * 2 - 1 >= 0 ? '+' : '') + ((val * 2 - 1) * 100).toFixed(0))), /*#__PURE__*/React.createElement("input", {
    type: "range",
    min: "0",
    max: "1",
    step: "0.01",
    value: val,
    onChange: e => setVal(+e.target.value),
    style: {
      width: '100%',
      accentColor: 'var(--primary-on-dark)',
      height: '4px'
    }
  }));
}
function EditorScreen({
  onBack
}) {
  const [stock, setStock] = React.useState('Portra 400');
  const [tool, setTool] = React.useState('develop');
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      background: 'var(--surface-tile-3)',
      color: 'var(--on-dark)'
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-sm)',
      padding: 'var(--space-sm) var(--space-lg)',
      borderBottom: '1px solid rgba(255,255,255,.1)'
    }
  }, /*#__PURE__*/React.createElement(IconButton, {
    label: "Back to library",
    variant: "plainOnDark",
    size: 32,
    onClick: onBack
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "chevron-left",
    size: 18,
    inv: true,
    op: .8
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--type-body-strong-size)',
      fontWeight: 'var(--type-body-strong-weight)',
      letterSpacing: 'var(--type-body-strong-ls)'
    }
  }, "IMG_0427.RAF"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--type-fine-print-size)',
      color: 'var(--ink-on-dark-muted)'
    }
  }, "6240 \xD7 4160 \xB7 \u0192/2.8 \xB7 1/250 \xB7 ISO 400")), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), ['develop', 'crop', 'heal'].map(t => /*#__PURE__*/React.createElement(IconButton, {
    key: t,
    label: t,
    variant: "plainOnDark",
    size: 32,
    onClick: () => setTool(t),
    style: {
      background: tool === t ? 'rgba(97,160,175,.22)' : 'transparent'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    n: t === 'develop' ? 'sliders-horizontal' : t === 'crop' ? 'crop' : 'wand-sparkles',
    size: 17,
    inv: true,
    op: tool === t ? 1 : .65
  }))), /*#__PURE__*/React.createElement(Button, {
    variant: "darkUtility",
    style: {
      background: 'rgba(255,255,255,.1)'
    }
  }, "Compare")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--space-xl)',
      gap: 'var(--space-md)',
      background: 'var(--surface-black)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      boxShadow: 'var(--shadow-product)',
      width: 'min(100%,640px)'
    }
  }, /*#__PURE__*/React.createElement(Photo, {
    i: 0,
    ratio: "3/2",
    label: "editor canvas \u2014 photo placeholder"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-xs)'
    }
  }, /*#__PURE__*/React.createElement(IconButton, {
    label: "Previous"
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "chevron-left",
    size: 18
  })), /*#__PURE__*/React.createElement(IconButton, {
    label: "Before / after"
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "columns-2",
    size: 18
  })), /*#__PURE__*/React.createElement(IconButton, {
    label: "Next"
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "chevron-right",
    size: 18
  })))), /*#__PURE__*/React.createElement("aside", {
    style: {
      width: '304px',
      flex: 'none',
      borderLeft: '1px solid rgba(255,255,255,.1)',
      padding: 'var(--space-lg)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-lg)',
      overflow: 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--type-micro-legal-size)',
      textTransform: 'uppercase',
      letterSpacing: '.08em',
      color: 'var(--ink-on-dark-muted)',
      marginBottom: 'var(--space-xs)'
    }
  }, "Film stock"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 'var(--space-xxs)'
    }
  }, STOCKS.map(([s, c]) => /*#__PURE__*/React.createElement(OptionChip, {
    key: s,
    onDark: true,
    label: s,
    selected: s === stock,
    onClick: () => setStock(s),
    thumb: /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'block',
        width: '20px',
        height: '20px',
        background: c
      }
    })
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-sm)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--type-micro-legal-size)',
      textTransform: 'uppercase',
      letterSpacing: '.08em',
      color: 'var(--ink-on-dark-muted)'
    }
  }, "Emulation"), SLIDERS.map(([l, v]) => /*#__PURE__*/React.createElement(Slider, {
    key: l,
    label: l,
    v: v
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid rgba(255,255,255,.1)',
      paddingTop: 'var(--space-md)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-xs)'
    }
  }, /*#__PURE__*/React.createElement(TextLink, {
    href: "#",
    onDark: true,
    size: "caption"
  }, "Save as preset \u203A"), /*#__PURE__*/React.createElement(TextLink, {
    href: "#",
    onDark: true,
    size: "caption"
  }, "Copy settings to 12 selected \u203A"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--type-fine-print-size)',
      color: 'var(--state-warning)'
    }
  }, "Halation above 50 renders slowly on Intel Macs.")))), /*#__PURE__*/React.createElement(StickyBar, {
    onDark: true,
    label: "Portra 400 \xB7 +30 exposure",
    detail: "Edits saved to the library, non-destructively",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "secondaryPill",
      onDark: true
    }, "Reset"), /*#__PURE__*/React.createElement(Button, null, "Export\u2026"))
  }));
}
Object.assign(window, {
  EditorScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/chromasmith-app/EditorScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/chromasmith-app/LibraryScreen.jsx
try { (() => {
const {
  SearchInput,
  OptionChip,
  IconButton,
  Button,
  TextLink
} = window.ChromasmithDesignSystem_b665ef;
const ALBUMS = [['Recents', 1284], ['Last import', 96], ['Favourites', 212], ['Rolls 2026', 640], ['Scanned negatives', 388], ['Client — Odell', 74]];
const STOCKS = ['All', 'Portra 400', 'Ektar 100', 'Tri-X 400', 'Cinestill 800T', 'Velvia 50'];
function LibraryScreen({
  onOpenPhoto,
  onNav
}) {
  const [stock, setStock] = React.useState('All');
  const [sel, setSel] = React.useState(4);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      height: '100%',
      minHeight: 0,
      background: 'var(--surface-tile-1)',
      color: 'var(--on-dark)'
    }
  }, /*#__PURE__*/React.createElement("aside", {
    style: {
      width: '232px',
      flex: 'none',
      borderRight: '1px solid rgba(255,255,255,.1)',
      padding: 'var(--space-md) 0',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-lg)',
      overflow: 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 var(--space-md)'
    }
  }, /*#__PURE__*/React.createElement(SearchInput, {
    onDark: true,
    icon: /*#__PURE__*/React.createElement(Icon, {
      n: "search",
      size: 15,
      inv: true,
      op: .6
    }),
    placeholder: "Search 12,480 photos"
  })), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      flexDirection: 'column'
    }
  }, ALBUMS.map(([name, n], i) => /*#__PURE__*/React.createElement("button", {
    key: name,
    onClick: () => setSel(i),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '8px var(--space-md)',
      background: sel === i ? 'rgba(97,160,175,.18)' : 'transparent',
      border: 'none',
      borderLeft: '2px solid ' + (sel === i ? 'var(--primary-on-dark)' : 'transparent'),
      color: 'var(--on-dark)',
      fontFamily: 'var(--font-text)',
      fontSize: 'var(--type-caption-size)',
      letterSpacing: 'var(--type-caption-ls)',
      cursor: 'pointer',
      textAlign: 'left'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    n: i === 2 ? 'star' : i === 1 ? 'download' : 'images',
    size: 15,
    inv: true,
    op: sel === i ? .95 : .6
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontWeight: sel === i ? 'var(--weight-semibold)' : 'var(--weight-regular)'
    }
  }, name), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-on-dark-muted)',
      fontSize: 'var(--type-fine-print-size)'
    }
  }, n)))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 var(--space-md)',
      marginTop: 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--type-micro-legal-size)',
      textTransform: 'uppercase',
      letterSpacing: '.08em',
      color: 'var(--ink-on-dark-muted)',
      marginBottom: '8px'
    }
  }, "Storage"), /*#__PURE__*/React.createElement("div", {
    style: {
      height: '4px',
      background: 'rgba(255,255,255,.14)',
      borderRadius: 'var(--radius-pill)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '62%',
      height: '100%',
      background: 'var(--primary-on-dark)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--type-fine-print-size)',
      color: 'var(--ink-on-dark-muted)',
      marginTop: '6px'
    }
  }, "124 GB of 200 GB"))), /*#__PURE__*/React.createElement("section", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-sm)',
      padding: 'var(--space-md) var(--space-lg)',
      borderBottom: '1px solid rgba(255,255,255,.1)'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontFamily: 'var(--font-display)',
      fontSize: 'var(--type-tagline-size)',
      fontWeight: 'var(--type-tagline-weight)',
      letterSpacing: 'var(--type-tagline-ls)',
      margin: 0
    }
  }, "Rolls 2026"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--type-caption-size)',
      color: 'var(--ink-on-dark-muted)'
    }
  }, "640 photos \xB7 21 rolls"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(IconButton, {
    label: "Grid size",
    variant: "plainOnDark",
    size: 32
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "layout-grid",
    size: 17,
    inv: true,
    op: .75
  })), /*#__PURE__*/React.createElement(IconButton, {
    label: "Sort",
    variant: "plainOnDark",
    size: 32
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "arrow-down-up",
    size: 17,
    inv: true,
    op: .75
  })), /*#__PURE__*/React.createElement(Button, {
    variant: "darkUtility",
    style: {
      background: 'rgba(255,255,255,.1)'
    }
  }, "Import"), /*#__PURE__*/React.createElement(Button, {
    onClick: () => onNav('editor')
  }, "Develop")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-xs)',
      padding: 'var(--space-sm) var(--space-lg)',
      overflowX: 'auto',
      borderBottom: '1px solid rgba(255,255,255,.1)'
    }
  }, STOCKS.map(s => /*#__PURE__*/React.createElement(OptionChip, {
    key: s,
    onDark: true,
    label: s,
    selected: s === stock,
    onClick: () => setStock(s),
    style: {
      flex: 'none'
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflow: 'auto',
      padding: 'var(--space-lg)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill,minmax(168px,1fr))',
      gap: 'var(--gutter-grid)'
    }
  }, Array.from({
    length: 18
  }).map((_, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    onClick: () => onOpenPhoto(i),
    style: {
      padding: 0,
      border: 'none',
      background: 'none',
      cursor: 'pointer',
      textAlign: 'left'
    }
  }, /*#__PURE__*/React.createElement(Photo, {
    i: i,
    ratio: "3/2",
    label: 'IMG_04' + (21 + i)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--type-fine-print-size)',
      color: 'var(--ink-on-dark-muted)',
      marginTop: '6px',
      letterSpacing: 'var(--type-fine-print-ls)'
    }
  }, STOCKS[1 + i % 5])))), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--type-fine-print-size)',
      color: 'var(--ink-on-dark-muted)',
      marginTop: 'var(--space-lg)'
    }
  }, "Frames are placeholders \u2014 no photography ships with this design system. ", /*#__PURE__*/React.createElement(TextLink, {
    href: "#",
    onDark: true,
    size: "caption"
  }, "Import your own \u203A")))));
}
Object.assign(window, {
  LibraryScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/chromasmith-app/LibraryScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/chromasmith-app/PacksScreen.jsx
try { (() => {
const {
  UtilityCard,
  Button,
  TextLink,
  SearchInput,
  OptionChip
} = window.ChromasmithDesignSystem_b665ef;
const PACKS = [['Kodachrome 64', '12 presets · Warm daylight', '$29', 'New'], ['Tri-X 400', '9 presets · B&W push', ' $29', null], ['Ektar 100', '14 presets · Saturated', '$34', null], ['Cinestill 800T', '8 presets · Tungsten halation', '$29', 'Pro'], ['Velvia 50', '11 presets · Landscape', '$34', null], ['Agfa Vista 200', '10 presets · Everyday', '$24', null], ['Ilford HP5', '9 presets · Grainy B&W', '$29', null], ['Fuji Superia', '12 presets · Cool green', '$24', null]];
function PacksScreen() {
  const [filter, setFilter] = React.useState('All');
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: '100%',
      overflow: 'auto',
      background: 'var(--canvas-parchment)',
      color: 'var(--ink)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-grid)',
      margin: '0 auto',
      padding: 'var(--space-xxl) var(--space-lg)'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontFamily: 'var(--font-display)',
      fontSize: 'var(--type-display-lg-size)',
      fontWeight: 'var(--type-display-lg-weight)',
      lineHeight: 'var(--type-display-lg-lh)',
      margin: '0 0 var(--space-sm)'
    }
  }, "Film Packs"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: 'var(--font-display)',
      fontSize: 'var(--type-lead-size)',
      fontWeight: 'var(--type-lead-weight)',
      lineHeight: 'var(--type-lead-lh)',
      letterSpacing: 'var(--type-lead-ls)',
      color: 'var(--ink-muted-80)',
      margin: '0 0 var(--space-xl)',
      maxWidth: '34ch'
    }
  }, "Stocks measured frame by frame, then rebuilt as curves."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-sm)',
      alignItems: 'center',
      flexWrap: 'wrap',
      marginBottom: 'var(--space-lg)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '280px'
    }
  }, /*#__PURE__*/React.createElement(SearchInput, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      n: "search",
      size: 16,
      op: .5
    }),
    placeholder: "Search packs"
  })), ['All', 'Colour negative', 'Slide', 'B&W'].map(x => /*#__PURE__*/React.createElement(OptionChip, {
    key: x,
    label: x,
    selected: x === filter,
    onClick: () => setFilter(x)
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "storeHero"
  }, "Get all 24 packs \u2014 $189")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))',
      gap: 'var(--gutter-grid)'
    }
  }, PACKS.map(([t, m, p, b], i) => /*#__PURE__*/React.createElement(UtilityCard, {
    key: t,
    badge: b,
    image: /*#__PURE__*/React.createElement(Photo, {
      i: i + 3,
      ratio: "1/1",
      label: "pack art"
    }),
    title: t,
    meta: m,
    price: p,
    action: /*#__PURE__*/React.createElement(TextLink, {
      href: "#",
      size: "caption"
    }, "Add to library \u203A")
  }))), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--type-fine-print-size)',
      color: 'var(--ink-muted-48)',
      marginTop: 'var(--space-xl)'
    }
  }, "Pack artwork is placeholder \u2014 no imagery ships with this design system.")));
}
Object.assign(window, {
  PacksScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/chromasmith-app/PacksScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/chromasmith-web/HomePage.jsx
try { (() => {
const {
  ProductTile,
  QuoteCard,
  Button,
  TextLink,
  UtilityCard
} = window.ChromasmithDesignSystem_b665ef;
function HomePage({
  go
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(ProductTile, {
    surface: "light",
    eyebrow: "Chromasmith 4",
    title: "Film, computed.",
    tagline: "A photo library that grades every raw file the way the stock would have.",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      onClick: () => go('pricing')
    }, "Try free for 14 days"), /*#__PURE__*/React.createElement(Button, {
      variant: "secondaryPill",
      onClick: () => go('packs')
    }, "See the film packs")),
    media: /*#__PURE__*/React.createElement("div", {
      style: {
        width: 'min(100%,980px)'
      }
    }, /*#__PURE__*/React.createElement(Photo, {
      i: 0,
      ratio: "21/9",
      label: "hero photograph \u2014 placeholder"
    }))
  }), /*#__PURE__*/React.createElement(ProductTile, {
    surface: "dark",
    title: "Grain that behaves like grain.",
    tagline: "Sampled from real stock at three exposure levels, then re-applied per channel.",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, null, "Watch the two-minute tour"), /*#__PURE__*/React.createElement(Button, {
      variant: "secondaryPill",
      onDark: true
    }, "Read the whitepaper")),
    media: /*#__PURE__*/React.createElement("div", {
      style: {
        width: 'min(100%,860px)'
      }
    }, /*#__PURE__*/React.createElement(Photo, {
      i: 2,
      ratio: "16/9",
      label: "grain comparison \u2014 placeholder"
    }))
  }), /*#__PURE__*/React.createElement(ProductTile, {
    surface: "parchment",
    align: "left",
    title: "Twelve thousand frames, one keystroke away.",
    tagline: "Chromasmith indexes the raw file, not a copy of it.",
    style: {
      alignItems: 'stretch'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
      gap: 'var(--gutter-grid)',
      width: '100%',
      maxWidth: 'var(--container-grid)',
      margin: 'var(--space-lg) auto 0'
    }
  }, [['Non-destructive', 'Every edit is a recipe stored beside the negative, never baked in.'], ['Roll-aware', 'Frames imported together stay together, with the stock read from EXIF where it exists.'], ['Local first', 'The library lives on your disk. Sync is optional and per-album.']].map(([t, b]) => /*#__PURE__*/React.createElement("div", {
    key: t,
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-xs)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    n: t === 'Local first' ? 'hard-drive' : t === 'Roll-aware' ? 'film' : 'layers',
    size: 22,
    op: .7
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--type-body-strong-size)',
      fontWeight: 'var(--type-body-strong-weight)',
      letterSpacing: 'var(--type-body-strong-ls)'
    }
  }, t), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--type-body-size)',
      lineHeight: 'var(--type-body-lh)',
      letterSpacing: 'var(--type-body-ls)',
      color: 'var(--ink-muted-80)',
      margin: 0
    }
  }, b))))), /*#__PURE__*/React.createElement(QuoteCard, {
    kicker: "Shot on Chromasmith",
    quote: "The grain lands where the light was.",
    attribution: "Mara Ellis, documentary photographer",
    action: /*#__PURE__*/React.createElement(Button, {
      onClick: () => go('packs')
    }, "Browse the packs")
  }), /*#__PURE__*/React.createElement(ProductTile, {
    surface: "light",
    title: "Twenty-four stocks. Perpetual licences.",
    tagline: "Buy the pack once; it stays in your library.",
    actions: /*#__PURE__*/React.createElement(Button, {
      variant: "secondaryPill",
      onClick: () => go('packs')
    }, "All film packs")
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
      gap: 'var(--gutter-grid)',
      width: '100%',
      maxWidth: '980px',
      margin: 'var(--space-xl) auto 0',
      textAlign: 'left'
    }
  }, [['Kodachrome 64', '12 presets · Warm daylight', '$29', 'New'], ['Tri-X 400', '9 presets · B&W push', '$29', null], ['Ektar 100', '14 presets · Saturated', '$34', null]].map(([t, m, p, b], i) => /*#__PURE__*/React.createElement(UtilityCard, {
    key: t,
    badge: b,
    image: /*#__PURE__*/React.createElement(Photo, {
      i: i + 4,
      ratio: "1/1",
      label: "pack art"
    }),
    title: t,
    meta: m,
    price: p,
    action: /*#__PURE__*/React.createElement(TextLink, {
      href: "#",
      size: "caption"
    }, "Buy \u203A")
  })))));
}
Object.assign(window, {
  HomePage
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/chromasmith-web/HomePage.jsx", error: String((e && e.message) || e) }); }

// ui_kits/chromasmith-web/PacksPage.jsx
try { (() => {
const {
  UtilityCard,
  SearchInput,
  OptionChip,
  Button,
  TextLink,
  ProductTile
} = window.ChromasmithDesignSystem_b665ef;
const PACKS = [['Kodachrome 64', '12 presets · Warm daylight', '$29', 'New'], ['Tri-X 400', '9 presets · B&W push', '$29', null], ['Ektar 100', '14 presets · Saturated', '$34', null], ['Cinestill 800T', '8 presets · Tungsten halation', '$29', 'Pro'], ['Velvia 50', '11 presets · Landscape', '$34', null], ['Agfa Vista 200', '10 presets · Everyday', '$24', null], ['Ilford HP5', '9 presets · Grainy B&W', '$29', null], ['Fuji Superia', '12 presets · Cool green', '$24', null], ['Portra 160', '13 presets · Skin tones', '$34', null], ['Provia 100F', '10 presets · Neutral slide', '$29', null]];
function PacksPage() {
  const [filter, setFilter] = React.useState('All');
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(ProductTile, {
    surface: "linen",
    tight: true,
    title: "Film Packs",
    tagline: "Stocks measured frame by frame, then rebuilt as curves."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--canvas)',
      padding: 'var(--space-xxl) 22px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-grid)',
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-sm)',
      alignItems: 'center',
      flexWrap: 'wrap',
      marginBottom: 'var(--space-lg)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '300px'
    }
  }, /*#__PURE__*/React.createElement(SearchInput, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      n: "search",
      size: 16,
      op: .5
    }),
    placeholder: "Search 24 packs"
  })), ['All', 'Colour negative', 'Slide', 'B&W'].map(x => /*#__PURE__*/React.createElement(OptionChip, {
    key: x,
    label: x,
    selected: x === filter,
    onClick: () => setFilter(x)
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "storeHero"
  }, "Get all 24 \u2014 $189")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))',
      gap: 'var(--gutter-grid)'
    }
  }, PACKS.map(([t, m, p, b], i) => /*#__PURE__*/React.createElement(UtilityCard, {
    key: t,
    badge: b,
    image: /*#__PURE__*/React.createElement(Photo, {
      i: i,
      ratio: "1/1",
      label: "pack art"
    }),
    title: t,
    meta: m,
    price: p,
    action: /*#__PURE__*/React.createElement(TextLink, {
      href: "#",
      size: "caption"
    }, "Buy \u203A")
  }))), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--type-fine-print-size)',
      color: 'var(--ink-muted-48)',
      marginTop: 'var(--space-xl)'
    }
  }, "Pack artwork is placeholder \u2014 no imagery ships with this design system."))));
}
Object.assign(window, {
  PacksPage
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/chromasmith-web/PacksPage.jsx", error: String((e && e.message) || e) }); }

// ui_kits/chromasmith-web/PricingPage.jsx
try { (() => {
const {
  ProductTile,
  UtilityCard,
  Button,
  TextLink,
  OptionChip
} = window.ChromasmithDesignSystem_b665ef;
const PLANS = [['Free', '$0', 'Library, import, three stocks', ['12,000 photo library', '3 film stocks', 'Local only']], ['Pro', '$89', 'per year — everything in the app', ['Unlimited library', 'All 24 stocks', 'Preset sync across Macs', 'Batch develop']], ['Studio', '$219', 'per year — for teams of five', ['Everything in Pro', 'Shared albums', 'Client proofing links', 'Priority support']]];
function PricingPage({
  go
}) {
  const [term, setTerm] = React.useState('Annual');
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(ProductTile, {
    surface: "parchment",
    tight: true,
    title: "Two ways to buy.",
    tagline: "A subscription for the app; perpetual licences for the film."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--canvas)',
      padding: 'var(--space-xxl) 22px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: '980px',
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-xs)',
      justifyContent: 'center',
      marginBottom: 'var(--space-xl)'
    }
  }, ['Monthly', 'Annual'].map(t => /*#__PURE__*/React.createElement(OptionChip, {
    key: t,
    label: t,
    detail: t === 'Annual' ? 'save 20%' : undefined,
    selected: t === term,
    onClick: () => setTerm(t)
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))',
      gap: 'var(--gutter-grid)'
    }
  }, PLANS.map(([name, price, sub, feats], i) => /*#__PURE__*/React.createElement(UtilityCard, {
    key: name,
    title: name,
    badge: i === 1 ? 'Most chosen' : null,
    style: i === 1 ? {
      boxShadow: 'inset 0 0 0 2px var(--primary)'
    } : null
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-display)',
      fontSize: 'var(--type-display-md-size)',
      fontWeight: 'var(--type-display-md-weight)',
      letterSpacing: 'var(--type-display-md-ls)',
      lineHeight: 1.1
    }
  }, term === 'Monthly' && price !== '$0' ? '$' + Math.round(parseInt(price.slice(1)) / 10) + '.00' : price), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--type-caption-size)',
      color: 'var(--ink-muted-48)',
      letterSpacing: 'var(--type-caption-ls)'
    }
  }, term === 'Monthly' && price !== '$0' ? 'per month' : sub), /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: 'none',
      padding: 0,
      margin: 'var(--space-sm) 0 0',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }
  }, feats.map(ft => /*#__PURE__*/React.createElement("li", {
    key: ft,
    style: {
      display: 'flex',
      gap: '8px',
      alignItems: 'flex-start',
      fontSize: 'var(--type-caption-size)',
      lineHeight: 'var(--type-caption-lh)',
      letterSpacing: 'var(--type-caption-ls)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "check",
    size: 15,
    op: .75
  }), /*#__PURE__*/React.createElement("span", null, ft)))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'var(--space-md)'
    }
  }, i === 1 ? /*#__PURE__*/React.createElement(Button, {
    fullWidth: true
  }, "Start 14-day trial") : /*#__PURE__*/React.createElement(Button, {
    variant: "secondaryPill",
    fullWidth: true
  }, i === 0 ? 'Download free' : 'Contact sales'))))), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--type-fine-print-size)',
      color: 'var(--ink-muted-48)',
      lineHeight: 1.6,
      marginTop: 'var(--space-xl)',
      textAlign: 'center'
    }
  }, "Trials convert to the ", term.toLowerCase(), " plan unless cancelled. Film pack licences are perpetual and survive a lapsed subscription. ", /*#__PURE__*/React.createElement(TextLink, {
    href: "#",
    size: "caption",
    onClick: () => go('packs')
  }, "See the packs \u203A")))));
}
Object.assign(window, {
  PricingPage
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/chromasmith-web/PricingPage.jsx", error: String((e && e.message) || e) }); }

// ui_kits/chromasmith-web/Site.jsx
try { (() => {
const {
  GlobalNav,
  SubNav,
  Footer,
  Button,
  IconButton,
  StickyBar,
  TextLink
} = window.ChromasmithDesignSystem_b665ef;
function Site() {
  const [page, setPage] = React.useState('home');
  const NAV = [['home', 'Overview'], ['packs', 'Film Packs'], ['pricing', 'Pricing']];
  const TITLES = {
    home: 'Chromasmith 4',
    packs: 'Film Packs',
    pricing: 'Buy'
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'sticky',
      top: 0,
      zIndex: 5
    }
  }, /*#__PURE__*/React.createElement(GlobalNav, {
    brand: "Chromasmith",
    links: [{
      label: 'Overview',
      active: page === 'home',
      onClick: () => setPage('home')
    }, {
      label: 'Film Packs',
      active: page === 'packs',
      onClick: () => setPage('packs')
    }, {
      label: 'Presets'
    }, {
      label: 'Pricing',
      active: page === 'pricing',
      onClick: () => setPage('pricing')
    }, {
      label: 'Support'
    }],
    right: /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '4px'
      }
    }, /*#__PURE__*/React.createElement(IconButton, {
      label: "Search",
      variant: "plainOnDark",
      size: 26
    }, /*#__PURE__*/React.createElement(Icon, {
      n: "search",
      size: 14,
      inv: true,
      op: .8
    })), /*#__PURE__*/React.createElement(IconButton, {
      label: "Bag",
      variant: "plainOnDark",
      size: 26
    }, /*#__PURE__*/React.createElement(Icon, {
      n: "shopping-bag",
      size: 14,
      inv: true,
      op: .8
    })))
  }), /*#__PURE__*/React.createElement(SubNav, {
    title: TITLES[page],
    links: NAV.map(([k, l]) => ({
      label: l,
      active: page === k,
      onClick: () => setPage(k)
    })),
    cta: /*#__PURE__*/React.createElement(Button, {
      style: {
        padding: '6px 15px',
        fontSize: 'var(--type-caption-size)'
      },
      onClick: () => setPage('pricing')
    }, "Buy")
  })), /*#__PURE__*/React.createElement("main", null, page === 'home' && /*#__PURE__*/React.createElement(HomePage, {
    go: setPage
  }), page === 'packs' && /*#__PURE__*/React.createElement(PacksPage, null), page === 'pricing' && /*#__PURE__*/React.createElement(PricingPage, {
    go: setPage
  })), /*#__PURE__*/React.createElement(Footer, {
    note: "Chromasmith Pro is billed annually and renews unless cancelled. Film pack licences are perpetual. Photography shown is placeholder.",
    legal: "Copyright \xA9 2026 Chromasmith Inc. All rights reserved.",
    columns: [{
      heading: 'Products',
      links: ['Chromasmith for Mac', 'Film Packs', 'Presets', 'Roadmap']
    }, {
      heading: 'Learn',
      links: ['Grading guide', 'Release notes', 'Keyboard shortcuts', 'Support']
    }, {
      heading: 'Buy',
      links: ['Pricing', 'Education', 'Studio licences', 'Redeem a code']
    }, {
      heading: 'Company',
      links: ['About', 'Photographers', 'Press', 'Contact']
    }]
  }), page === 'pricing' && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'sticky',
      bottom: 0,
      zIndex: 5
    }
  }, /*#__PURE__*/React.createElement(StickyBar, {
    label: "$89.00",
    detail: "Chromasmith Pro \xB7 annual",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(TextLink, {
      href: "#",
      size: "caption"
    }, "Compare plans"), /*#__PURE__*/React.createElement(Button, null, "Add to bag"))
  })));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(Site, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/chromasmith-web/Site.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.TextLink = __ds_scope.TextLink;

__ds_ns.OptionChip = __ds_scope.OptionChip;

__ds_ns.SearchInput = __ds_scope.SearchInput;

__ds_ns.Footer = __ds_scope.Footer;

__ds_ns.GlobalNav = __ds_scope.GlobalNav;

__ds_ns.SubNav = __ds_scope.SubNav;

__ds_ns.ProductTile = __ds_scope.ProductTile;

__ds_ns.QuoteCard = __ds_scope.QuoteCard;

__ds_ns.StickyBar = __ds_scope.StickyBar;

__ds_ns.UtilityCard = __ds_scope.UtilityCard;

})();
