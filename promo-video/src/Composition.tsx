import {
  AbsoluteFill,
  Composition,
  Easing,
  Img,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";

type PromoProps = {
  accent?: string;
};

const FPS = 30;
const SCENE = {
  intro: 150,
  feature: 180,
  review: 150,
  outro: 150,
};

const colors = {
  ink: "#070b12",
  blue: "#77aefc",
  cyan: "#72e2d0",
  gold: "#e7c56e",
  text: "#f5f8ff",
  muted: "#9ba8bc",
};

const fontFamily =
  "Inter, -apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei, sans-serif";
const SCREEN_MAX_WIDTH = 996;
const SCREEN_TOP = 520;
const SCREEN_CHROME_HEIGHT = 35;
const SCREEN_ASPECTS: Record<string, number> = {
  "today-dark.png": 3360 / 2000,
  "holdings-dark.png": 3360 / 2000,
  "analysis-dark.png": 3360 / 2000,
  "quant-dark.png": 3360 / 2000,
  "review-dark.png": 3360 / 2000,
};

const fade = (frame: number, duration: number) =>
  interpolate(frame, [0, 18, duration - 20, duration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

const entrance = (frame: number) =>
  interpolate(frame, [0, 28], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

const Background = () => (
  <AbsoluteFill
    style={{
      backgroundColor: colors.ink,
      backgroundImage:
        "radial-gradient(circle at 78% 22%, rgba(83, 130, 212, 0.2), transparent 30%), radial-gradient(circle at 12% 86%, rgba(46, 135, 145, 0.13), transparent 27%), linear-gradient(135deg, #070b12 0%, #0b111c 55%, #070b12 100%)",
      overflow: "hidden",
    }}
  >
    <div className="grid-overlay" />
    <div className="grain-overlay" />
  </AbsoluteFill>
);

const BrandMark = ({ size = 52 }: { size?: number }) => (
  <Img
    src={staticFile("assets/rportfolio.svg")}
    style={{ width: size, height: size, objectFit: "contain" }}
  />
);

const Eyebrow = ({
  children,
  accent = colors.blue,
}: {
  children: string;
  accent?: string;
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "8px 16px",
      border: `1px solid ${accent}55`,
      borderRadius: 999,
      backgroundColor: `${accent}12`,
      color: accent,
      fontFamily,
      fontSize: 18,
      fontWeight: 700,
      letterSpacing: "0.12em",
    }}
  >
    <span
      style={{
        width: 24,
        height: 2,
        backgroundColor: accent,
        display: "inline-block",
      }}
    />
    {children}
  </div>
);

const Intro = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const appear = entrance(frame);
  return (
    <AbsoluteFill
      style={{ opacity: fade(frame, durationInFrames), fontFamily }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 72px",
          scale: interpolate(frame, [0, durationInFrames], [0.97, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <div
          style={{
            opacity: appear,
            translate:
              String(
                interpolate(frame, [0, 28], [-30, 0], {
                  extrapolateRight: "clamp",
                }),
              ) + "px 0px",
          }}
        >
          <BrandMark size={72} />
        </div>
        <div style={{ height: 44 }} />
        <Eyebrow>RPORTFOLIO / PRODUCT FILM</Eyebrow>
        <div style={{ height: 26 }} />
        <h1
          style={{
            margin: 0,
            maxWidth: 1100,
            color: colors.text,
            fontSize: 70,
            lineHeight: 1.06,
            fontWeight: 700,
            letterSpacing: "-0.04em",
            opacity: appear,
            translate:
              String(
                interpolate(frame, [0, 32], [34, 0], {
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }),
              ) + "px 0px",
          }}
        >
          把组合管理，变成一套
          <br />
          <span style={{ color: colors.blue }}>可复核的决策系统</span>
        </h1>
        <div style={{ height: 30 }} />
        <p
          style={{
            margin: 0,
            color: colors.muted,
            fontSize: 28,
            letterSpacing: "0.04em",
            opacity: interpolate(frame, [18, 50], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          让每一个持仓、每一次判断，都有依据可循。
        </p>
        <div style={{ height: 72 }} />
        <div style={{ display: "flex", gap: 14, opacity: appear }}>
          {["持仓", "风险", "交易", "复盘"].map((label, index) => (
            <div
              key={label}
              style={{
                padding: "12px 22px",
                border:
                  "1px solid " +
                  (index === 0
                    ? "rgba(119,174,252,0.65)"
                    : "rgba(155,168,188,0.2)"),
                borderRadius: 999,
                color: index === 0 ? colors.blue : colors.muted,
                fontSize: 19,
                letterSpacing: "0.12em",
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
      <div className="hero-orbit orbit-one" />
      <div className="hero-orbit orbit-two" />
    </AbsoluteFill>
  );
};

type FeatureSceneProps = {
  image: string;
  eyebrow: string;
  title: string;
  description: string;
  accent?: string;
  index: string;
};

const FeatureScene = ({
  image,
  eyebrow,
  title,
  description,
  accent = colors.blue,
  index,
}: FeatureSceneProps) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const shellWidth = SCREEN_MAX_WIDTH;
  const imageHeight = Math.round(
    shellWidth / (SCREEN_ASPECTS[image] ?? 16 / 9),
  );
  const shellHeight = imageHeight + SCREEN_CHROME_HEIGHT;
  return (
    <AbsoluteFill
      style={{ opacity: fade(frame, durationInFrames), fontFamily }}
    >
      <div
        style={{
          position: "absolute",
          left: 72,
          right: 72,
          top: 92,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          opacity: entrance(frame),
          translate:
            "0px " +
            String(
              interpolate(frame, [0, 28], [24, 0], {
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            ) +
            "px",
        }}
      >
        <div>
          <Eyebrow accent={accent}>{eyebrow}</Eyebrow>
          <h2
            style={{
              margin: "24px 0 0",
              color: colors.text,
              fontSize: 48,
              lineHeight: 1.16,
              letterSpacing: "-0.03em",
            }}
          >
            {title}
          </h2>
          <p
            style={{
              margin: "16px 0 0",
              display: "flex",
              alignItems: "center",
              gap: 12,
              maxWidth: 860,
              color: colors.muted,
              fontSize: 21,
              letterSpacing: "0.03em",
            }}
          >
            <span style={{ color: accent, fontSize: 16 }}>●</span>
            {description}
          </p>
        </div>
        <div
          style={{
            color: accent,
            fontSize: 20,
            letterSpacing: "0.18em",
            fontWeight: 700,
          }}
        >
          {index}
        </div>
      </div>
      <div
        className="screen-shell"
        style={{
          position: "absolute",
          left: "50%",
          width: shellWidth,
          marginLeft: -shellWidth / 2,
          top: SCREEN_TOP,
          height: shellHeight,
          opacity: entrance(frame),
          scale: interpolate(frame, [0, durationInFrames], [1.045, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate:
            "0px " +
            String(
              interpolate(frame, [0, 32], [28, 0], {
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            ) +
            "px",
        }}
      >
        <div className="screen-chrome">
          <div style={{ display: "flex", gap: 8 }}>
            <span
              className="chrome-dot"
              style={{ backgroundColor: "#ff6b6b" }}
            />
            <span
              className="chrome-dot"
              style={{ backgroundColor: "#f0c674" }}
            />
            <span
              className="chrome-dot"
              style={{ backgroundColor: "#59d38c" }}
            />
          </div>
          <div
            style={{ color: "#68768a", fontSize: 13, letterSpacing: "0.12em" }}
          >
            RPORTFOLIO / WORKSPACE
          </div>
          <div style={{ width: 58 }} />
        </div>
        <div
          style={{
            position: "absolute",
            inset: `${SCREEN_CHROME_HEIGHT}px 0 0`,
            overflow: "hidden",
            backgroundColor: "#0b1018",
          }}
        >
          <Img
            src={staticFile("assets/" + image)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              objectPosition: "center",
              scale: interpolate(frame, [0, durationInFrames], [1, 1.02], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          />
          <div className="screen-vignette" />
        </div>
        <div
          className="screen-sheen"
          style={{
            translate:
              String(
                interpolate(frame, [0, durationInFrames], [-900, 1100], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.linear,
                }),
              ) + "px 0px",
          }}
        />
      </div>
      <div
        className="feature-footer"
        style={{
          top: "auto",
          bottom: 110,
          opacity: interpolate(frame, [20, 52], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <span>DESIGNED FOR CLARITY</span>
        <span style={{ color: accent }}>●</span>
        <span>BUILT FOR DECISIONS</span>
      </div>
    </AbsoluteFill>
  );
};

const Outro = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        opacity: fade(frame, durationInFrames),
        fontFamily,
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
          opacity: entrance(frame),
          scale: interpolate(frame, [0, 35], [0.92, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <BrandMark size={132} />
        <h2
          style={{
            margin: "34px 0 0",
            color: colors.text,
            fontSize: 68,
            letterSpacing: "-0.04em",
          }}
        >
          看见结构，掌控节奏。
        </h2>
        <p
          style={{
            margin: "20px 0 0",
            color: colors.muted,
            fontSize: 24,
            letterSpacing: "0.16em",
          }}
        >
          rPortfolio · A decision system for real portfolios
        </p>
        <div
          style={{
            marginTop: 40,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div
            style={{
              padding: "16px 28px",
              borderRadius: 16,
              border: "1px solid rgba(119,174,252,0.34)",
              background: "linear-gradient(180deg, rgba(119,174,252,0.2), rgba(119,174,252,0.06))",
              color: colors.text,
              fontSize: 25,
              fontWeight: 700,
            }}
          >
            Website · rportfolio.rurie.top
          </div>
          <div style={{ color: colors.muted, fontSize: 23, letterSpacing: "0.04em" }}>
            GitHub · github.com/r-series-lab/rportfolio
          </div>
        </div>
        <div
          style={{
            marginTop: 44,
            color: colors.blue,
            fontSize: 18,
            letterSpacing: "0.22em",
            fontWeight: 700,
          }}
        >
          RPORTFOLIO / MAKE EVERY DECISION COUNT
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const RPortfolioPromo: React.FC<PromoProps> = () => (
  <AbsoluteFill>
    <Background />
    <Sequence durationInFrames={SCENE.intro}>
      <Intro />
    </Sequence>
    <Sequence from={SCENE.intro} durationInFrames={SCENE.feature}>
      <FeatureScene
        image="today-dark.png"
        eyebrow="01 / DAILY OPERATIONS"
        title="让今天的行动，有据可循"
        description="把待处理、阻断、延期与已闭环，放进一条清晰的行动链路。"
        index="01"
      />
    </Sequence>
    <Sequence
      from={SCENE.intro + SCENE.feature}
      durationInFrames={SCENE.feature}
    >
      <FeatureScene
        image="holdings-dark.png"
        eyebrow="02 / HOLDINGS"
        title="每个持仓，都有自己的边界"
        description="目标区间、盈亏、状态与建议，在同一个工作台里保持一致。"
        accent={colors.gold}
        index="02"
      />
    </Sequence>
    <Sequence
      from={SCENE.intro + SCENE.feature * 2}
      durationInFrames={SCENE.feature}
    >
      <FeatureScene
        image="analysis-dark.png"
        eyebrow="03 / PORTFOLIO DECISION"
        title="把信号、风险与机会放在同一张图上"
        description="从结构风险到信号质量，让组合判断更完整、更可解释。"
        accent={colors.cyan}
        index="03"
      />
    </Sequence>
    <Sequence
      from={SCENE.intro + SCENE.feature * 3}
      durationInFrames={SCENE.feature}
    >
      <FeatureScene
        image="quant-dark.png"
        eyebrow="04 / QUANT EXECUTION"
        title="规则先行，执行更稳"
        description="让建议经过条件、风控与路由，再进入可追踪的执行流程。"
        accent={colors.gold}
        index="04"
      />
    </Sequence>
    <Sequence
      from={SCENE.intro + SCENE.feature * 4}
      durationInFrames={SCENE.review}
    >
      <FeatureScene
        image="review-dark.png"
        eyebrow="05 / REVIEW"
        title="把每一次判断，沉淀成下一次优势"
        description="记录估值、结果与阻断，让复盘真正成为系统的一部分。"
        accent={colors.blue}
        index="05"
      />
    </Sequence>
    <Sequence
      from={SCENE.intro + SCENE.feature * 4 + SCENE.review}
      durationInFrames={SCENE.outro}
    >
      <Outro />
    </Sequence>
  </AbsoluteFill>
);

export const RemotionComposition = () => (
  <Composition
    id="RPortfolioPromo"
    component={RPortfolioPromo}
    durationInFrames={
      SCENE.intro + SCENE.feature * 4 + SCENE.review + SCENE.outro
    }
    fps={FPS}
    width={1080}
    height={1920}
    defaultProps={{ accent: colors.blue }}
  />
);
