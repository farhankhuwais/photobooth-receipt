/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: "class",
  theme: {
      extend: {
          "colors": {
              "on-error": "#ffffff",
              "secondary-fixed-dim": "#ffabf3",
              "surface-container": "#eeeeee",
              "surface-container-lowest": "#ffffff",
              "tertiary-fixed-dim": "#bec2ff",
              "primary": "#626200",
              "surface-container-high": "#e8e8e8",
              "error": "#ba1a1a",
              "on-tertiary-fixed": "#00006e",
              "inverse-primary": "#cdcd00",
              "on-surface": "#1b1b1b",
              "tertiary-fixed": "#e0e0ff",
              "on-secondary-fixed-variant": "#810081",
              "on-secondary": "#ffffff",
              "on-primary": "#ffffff",
              "secondary-fixed": "#ffd7f5",
              "surface": "#f9f9f9",
              "surface-dim": "#dadada",
              "background": "#f9f9f9",
              "secondary": "#a900a9",
              "on-secondary-fixed": "#380038",
              "on-tertiary": "#ffffff",
              "inverse-on-surface": "#f1f1f1",
              "error-container": "#ffdad6",
              "on-error-container": "#93000a",
              "tertiary-container": "#f8f5ff",
              "primary-container": "#ffff00",
              "primary-fixed-dim": "#cdcd00",
              "on-background": "#1b1b1b",
              "secondary-container": "#fe00fe",
              "outline": "#79785f",
              "on-surface-variant": "#484831",
              "surface-tint": "#626200",
              "outline-variant": "#cac8aa",
              "on-tertiary-container": "#505bff",
              "tertiary": "#343dff",
              "surface-bright": "#f9f9f9",
              "surface-container-low": "#f3f3f3",
              "on-secondary-container": "#500050",
              "on-primary-fixed": "#1d1d00",
              "on-primary-container": "#757500",
              "surface-container-highest": "#e2e2e2",
              "primary-fixed": "#eaea00",
              "inverse-surface": "#303030",
              "surface-variant": "#e2e2e2",
              "on-primary-fixed-variant": "#494900",
              "on-tertiary-fixed-variant": "#0000ef"
          },
          "borderRadius": {
              "DEFAULT": "0.25rem",
              "lg": "0.5rem",
              "xl": "0.75rem",
              "full": "9999px"
          },
          "spacing": {
              "unit": "4px",
              "xl": "40px",
              "xs": "4px",
              "margin-mobile": "16px",
              "sm": "8px",
              "md": "16px",
              "lg": "24px",
              "gutter": "16px",
              "margin-desktop": "32px"
          },
          "fontFamily": {
              "headline-lg-mobile": ["Outfit"],
              "headline-lg": ["Outfit"],
              "label-bold": ["Inter"],
              "display": ["Outfit"],
              "headline-md": ["Outfit"],
              "body-lg": ["Inter"],
              "body-md": ["Inter"]
          },
          "fontSize": {
              "headline-lg-mobile": ["32px", { "lineHeight": "1.1", "fontWeight": "800" }],
              "headline-lg": ["48px", { "lineHeight": "1.1", "letterSpacing": "-0.02em", "fontWeight": "800" }],
              "label-bold": ["14px", { "lineHeight": "1.0", "fontWeight": "700" }],
              "display": ["80px", { "lineHeight": "1.0", "letterSpacing": "-0.04em", "fontWeight": "900" }],
              "headline-md": ["24px", { "lineHeight": "1.2", "fontWeight": "800" }],
              "body-lg": ["20px", { "lineHeight": "1.5", "fontWeight": "600" }],
              "body-md": ["16px", { "lineHeight": "1.5", "fontWeight": "500" }]
          }
      }
  },
  plugins: []
}
