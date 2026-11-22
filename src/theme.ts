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
    xs: "3px",
    sm: "5px",
    md: "7px",
    lg: "9px",
    xl: "12px",
  },
  shadows: {
    xs: "0 1px 2px rgba(24, 24, 27, 0.04)",
    sm: "0 1px 3px rgba(24, 24, 27, 0.06)",
    md: "0 4px 12px rgba(24, 24, 27, 0.06)",
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
