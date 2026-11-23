import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Grounded, Swiss-editorial forest pine palette — crisp, authoritative, zero "AI neon"
const forest: MantineColorsTuple = [
  "#eef7f1",
  "#dcece1",
  "#b7d9c2",
  "#8ec4a0",
  "#68b182",
  "#4ea46d",
  "#3e9c61",
  "#2e854f",
  "#237443",
  "#166534",
];

const stone: MantineColorsTuple = [
  "#faf9f7",
  "#f3f2ee",
  "#e6e4de",
  "#d6d3cb",
  "#bab6ab",
  "#9a9589",
  "#787368",
  "#57534a",
  "#37342e",
  "#1c1a17",
];

export const myleadTheme = createTheme({
  primaryColor: "forest",
  primaryShade: { light: 9, dark: 6 },
  colors: {
    forest,
    stone,
  },
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontFamilyMonospace:
    '"SF Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  headings: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontWeight: "600",
  },
  defaultRadius: "sm",
  radius: {
    xs: "4px",
    sm: "6px",
    md: "10px",
    lg: "14px",
    xl: "20px",
  },
  spacing: {
    xs: "10px",
    sm: "14px",
    md: "20px",
    lg: "28px",
    xl: "40px",
  },
  shadows: {
    xs: "0 1px 2px rgba(24, 24, 27, 0.05)",
    sm: "0 1px 3px rgba(24, 24, 27, 0.07), 0 1px 2px rgba(24, 24, 27, 0.04)",
    md: "0 6px 18px rgba(24, 24, 27, 0.08), 0 1px 4px rgba(24, 24, 27, 0.05)",
    lg: "0 12px 32px rgba(24, 24, 27, 0.12), 0 2px 8px rgba(24, 24, 27, 0.06)",
    xl: "0 24px 56px rgba(24, 24, 27, 0.16), 0 4px 12px rgba(24, 24, 27, 0.08)",
  },
  components: {
    Paper: {
      defaultProps: {
        withBorder: true,
        shadow: "none",
      },
    },
    Card: {
      defaultProps: {
        withBorder: true,
        shadow: "none",
      },
    },
    Button: {
      defaultProps: {
        size: "sm",
      },
      styles: {
        root: {
          fontWeight: 500,
        },
      },
    },
    Badge: {
      defaultProps: {
        radius: "xs",
        variant: "light",
      },
      styles: {
        root: {
          fontWeight: 500,
          textTransform: "none",
          letterSpacing: "0",
        },
      },
    },
    Table: {
      defaultProps: {
        highlightOnHover: true,
        verticalSpacing: "xs",
        horizontalSpacing: "sm",
      },
    },
  },
});
