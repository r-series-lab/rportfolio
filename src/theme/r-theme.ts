import { alpha, createTheme } from "@mui/material/styles";

export type RPortfolioStyleMode = "dark" | "light";

const fontFamily = [
  '"SF Pro Display"',
  '"Avenir Next"',
  '"PingFang SC"',
  '"Hiragino Sans GB"',
  '"Microsoft YaHei"',
  "sans-serif",
].join(", ");

const darkTokens = {
  selection: "rgba(245, 239, 226, 0.24)",
  appBackground: "#070909",
  paper: "rgba(19, 17, 15, 0.88)",
  paperSolid: "rgba(19, 17, 15, 0.88)",
  paperGradient: "none",
  border: "rgba(232,75,67,0.12)",
  borderStrong: "rgba(232,75,67,0.24)",
  subtle: "rgba(255,255,255,0.025)",
  subtleHover: "rgba(255,255,255,0.06)",
  primaryText: "#f3f0e9",
  secondaryText: "#9aa3ad",
  mutedText: "#908a83",
  buttonText: "#fff7ef",
  buttonBackground: "#e84b43",
  buttonHoverBackground: "#f35a52",
  shadow: "0 18px 46px rgba(0,0,0,0.32)",
  menuBackground: "rgba(22, 18, 16, 0.97)",
  menuGradient: "linear-gradient(180deg, rgba(232,75,67,0.08), rgba(255,255,255,0.025))",
  accent: "#e84b43",
  accentHover: "#f35a52",
  accentSoft: "rgba(232,75,67,0.08)",
  accentBorder: "rgba(232,75,67,0.2)",
  secondary: "#d7c46f",
};

const lightTokens = {
  selection: "rgba(37, 99, 235, 0.16)",
  appBackground: "#f4f7fb",
  paper: "rgba(255,255,255,0.9)",
  paperSolid: "#fbfdff",
  paperGradient: "none",
  border: "rgba(42,82,132,0.16)",
  borderStrong: "rgba(37,99,235,0.24)",
  subtle: "rgba(31,37,48,0.035)",
  subtleHover: "rgba(37,99,235,0.065)",
  primaryText: "#172133",
  secondaryText: "#58667c",
  mutedText: "#6f7e94",
  buttonText: "#ffffff",
  buttonBackground: "#2563eb",
  buttonHoverBackground: "#2f6ff4",
  shadow: "0 18px 40px rgba(46,83,126,0.1), inset 0 1px 0 rgba(255,255,255,0.82)",
  menuBackground: "rgba(251,253,255,0.98)",
  menuGradient: "linear-gradient(180deg, rgba(37,99,235,0.055), rgba(255,255,255,0.64))",
  accent: "#2563eb",
  accentHover: "#2f6ff4",
  accentSoft: "rgba(37,99,235,0.055)",
  accentBorder: "rgba(37,99,235,0.2)",
  secondary: "#2563eb",
};

export function createRPortfolioTheme(styleMode: RPortfolioStyleMode) {
  const light = styleMode === "light";
  const tokens = light ? lightTokens : darkTokens;
  const cssVariables = {
    "--text-primary": tokens.primaryText,
    "--text-secondary": tokens.secondaryText,
    "--text-muted": tokens.mutedText,
    "--panel-border": tokens.border,
    "--surface-quiet": tokens.subtle,
    "--surface-lift": tokens.subtleHover,
    "--line-soft": tokens.border,
    "--line-visible": tokens.borderStrong,
  };

  return createTheme({
    shape: {
      borderRadius: 10,
    },
    typography: {
      fontFamily,
      button: {
        fontWeight: 700,
        letterSpacing: 0,
        textTransform: "none",
      },
    },
    palette: {
      mode: light ? "light" : "dark",
      primary: {
        main: tokens.accent,
        light: tokens.accentHover,
        dark: light ? "#9f2f2c" : "#a72f2a",
        contrastText: tokens.buttonText,
      },
      secondary: {
        main: tokens.secondary,
      },
      background: {
        default: tokens.appBackground,
        paper: tokens.paper,
      },
      text: {
        primary: tokens.primaryText,
        secondary: tokens.secondaryText,
      },
      divider: tokens.border,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          "::selection": {
            backgroundColor: tokens.selection,
          },
          body: {
            ...cssVariables,
            backgroundColor: tokens.appBackground,
            color: tokens.primaryText,
          },
        },
      },
      MuiButton: {
        defaultProps: {
          disableElevation: true,
        },
        styleOverrides: {
          root: {
            borderRadius: 10,
            minHeight: 38,
          },
          contained: {
            color: tokens.buttonText,
            background: tokens.buttonBackground,
            boxShadow: light
              ? "0 12px 24px rgba(37,99,235,0.18), inset 0 1px 0 rgba(255,255,255,0.32)"
              : "0 14px 28px rgba(232,75,67,0.2), inset 0 1px 0 rgba(255,255,255,0.18)",
            "&:hover": {
              background: tokens.buttonHoverBackground,
            },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            color: tokens.primaryText,
            borderColor: tokens.border,
            backgroundColor: tokens.subtle,
            "&:hover": {
              borderColor: tokens.borderStrong,
              backgroundColor: tokens.subtleHover,
            },
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: tokens.paperGradient,
            backgroundColor: tokens.paperSolid,
            border: `1px solid ${tokens.border}`,
            boxShadow: tokens.shadow,
            backdropFilter: light ? "none" : "blur(20px)",
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 9,
            border: `1px solid ${tokens.border}`,
            backgroundColor: tokens.subtle,
            color: tokens.primaryText,
            fontWeight: 700,
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            backgroundColor: tokens.subtle,
            boxShadow: `inset 0 1px 0 ${alpha("#fff", light ? 0.7 : 0.04)}`,
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: tokens.border,
            },
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: tokens.borderStrong,
            },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderColor: tokens.accentBorder,
              boxShadow: `0 0 0 2px ${tokens.accentSoft}`,
            },
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            marginTop: 6,
            borderRadius: 10,
            border: `1px solid ${tokens.border}`,
            backgroundImage: tokens.menuGradient,
            backgroundColor: tokens.menuBackground,
            boxShadow: light ? "0 18px 38px rgba(88,63,38,0.14)" : "0 18px 42px rgba(0,0,0,0.34)",
          },
          list: {
            paddingTop: 4,
            paddingBottom: 4,
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            minHeight: 34,
            margin: "2px 4px",
            borderRadius: 8,
            fontSize: "0.8rem",
            fontWeight: 700,
            "&.Mui-selected": {
              backgroundColor: tokens.subtleHover,
            },
            "&.Mui-selected:hover": {
              backgroundColor: light ? "rgba(37,99,235,0.09)" : "rgba(255,255,255,0.14)",
            },
          },
        },
      },
      MuiSelect: {
        styleOverrides: {
          select: {
            minHeight: "1.35em",
          },
        },
      },
      MuiTooltip: {
        defaultProps: {
          arrow: true,
        },
        styleOverrides: {
          tooltip: {
            maxWidth: 260,
            padding: "7px 9px",
            borderRadius: 8,
            border: `1px solid ${tokens.borderStrong}`,
            color: tokens.primaryText,
            backgroundColor: light ? "rgba(251,253,255,0.98)" : "rgba(11,12,12,0.96)",
            backgroundImage: light
              ? "linear-gradient(180deg, rgba(37,99,235,0.055), rgba(255,255,255,0.72))"
              : "linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.018))",
            boxShadow: light ? "0 14px 30px rgba(46,83,126,0.14)" : "0 16px 34px rgba(0,0,0,0.42)",
            fontSize: "0.68rem",
            fontWeight: 780,
            lineHeight: 1.42,
            whiteSpace: "pre-line",
            backdropFilter: light ? "none" : "blur(14px)",
          },
          arrow: {
            color: light ? "rgba(251,253,255,0.98)" : "rgba(11,12,12,0.96)",
            "&::before": {
              border: `1px solid ${tokens.borderStrong}`,
              boxSizing: "border-box",
            },
          },
        },
      },
    },
  });
}

export const rPortfolioTheme = createRPortfolioTheme("dark");
