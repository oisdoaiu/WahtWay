// PPTX 工具 — V0.22
// read-ppt: 解析 PPTX 结构 → JSON
// create-ppt: 生成 PPTX 文件

import * as fs from "fs";
import * as path from "path";
import AdmZip from "adm-zip";
import { ToolDef } from "../types";

// ===== read-ppt =====

export const readPptTool: ToolDef = {
  name: "read-ppt",
  description: "读取 PPTX 文件的结构和内容，返回每页的文本、布局信息。用于分析现有PPT、提取内容进行美化或套模板。",
  input_examples: [
    { description: "读取旧PPT分析结构", args: { path: "C:\\Users\\asus\\Desktop\\旧版.pptx" } },
    { description: "读取模板PPT", args: { path: "C:\\Users\\asus\\Templates\\商务模板.pptx" } },
  ],
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "PPTX 文件完整路径" },
    },
    required: ["path"],
  },
  execute: async (args) => {
    const fp = String(args.path);
    if (!fs.existsSync(fp)) return "文件不存在: " + fp;
    if (path.extname(fp).toLowerCase() !== ".pptx") return "仅支持 .pptx 格式";
    try {
      const zip = new AdmZip(fp);
      const re = new RegExp("<a:t[^>]*>([^<]*)<\\/a:t>", "g");
      const slides: any[] = [];
      const entries = zip.getEntries().filter(e =>
        e.entryName.startsWith("ppt/slides/slide") && e.entryName.endsWith(".xml")
      ).sort((a, b) => {
        const na = parseInt(a.entryName.match(/slide(\d+)/)?.[1] || "0");
        const nb = parseInt(b.entryName.match(/slide(\d+)/)?.[1] || "0");
        return na - nb;
      });
      for (const entry of entries) {
        const xml = entry.getData().toString("utf-8");
        const texts: string[] = [];
        let m;
        while ((m = re.exec(xml)) !== null) {
          if (m[1]) texts.push(m[1]);
        }
        const hasChart = xml.includes("<c:chart") || xml.includes("graphicData");
          const hasTable = xml.includes("<a:tbl>");
          const hasImage = xml.includes("<a:blip");
          let layoutType = "content";
          if (texts.length <= 2 && texts[0] && texts[0].length < 30) layoutType = "section";
          if (hasChart) layoutType = "chart";
          if (hasTable) layoutType = "table";
          if (slides.length === 0) layoutType = "cover";
          if (texts.length > 0) {
          slides.push({
            slide: slides.length + 1,
            title: texts[0] || "",
            content: texts.slice(1),
            textCount: texts.length,
            layoutType: "content",
            features: {},
          });
        }
      }
      if (slides.length === 0) return "PPT 为空或无法解析";
      return JSON.stringify({
        file: path.basename(fp),
        totalSlides: slides.length,
        slides,
      }, null, 2);
    } catch (e: any) {
      return "读取 PPT 失败: " + e.message;
    }
  },
};

// ===== create-ppt =====

export const createPptTool: ToolDef = {
  name: "create-ppt",
  description: "创建新的 PowerPoint 演示文稿。提供每页标题和要点，可选模板路径和主题配色。6种内置主题: business/modern/warm/dark/minimal/creative。LLM 应先用 read-ppt 读取模板结构，再将内容映射到模板布局。",
  input_examples: [
    {
      description: "从文案生成3页PPT",
      args: {
        slides: [
          { title: "AI 发展趋势", bullets: ["大模型加速落地", "多模态成为标配", "Agent 生态爆发"] },
          { title: "市场规模", bullets: ["2025年全球AI市场达5000亿美元", "年增长率超30%"] },
          { title: "总结与展望", bullets: ["技术民主化", "行业深度融合"] },
        ],
        outputPath: "C:\\Users\\asus\\Desktop\\AI发展.pptx",
      }
    },
    {
      description: "用模板生成PPT",
      args: {
        slides: [
          { title: "季度汇报", bullets: ["收入增长20%", "新客户50+"] },
        ],
        outputPath: "C:\\Users\\asus\\Desktop\\汇报.pptx",
        templatePath: "C:\\Users\\asus\\Templates\\公司模板.pptx",
      }
    },
  ],
  parameters: {
    type: "object",
    properties: {
      slides: { type: "array", description: "幻灯片数组。layout: cover|content|closing|chart(body+type)|table(body)|three-cards(cards)|big-number(num)|image-text|process(steps)" },
      outputPath: { type: "string", description: "输出 .pptx 文件路径" },
      theme: { type: "string", description: "主题配色: business/modern/warm/dark/minimal/creative（默认business）" },
      templatePath: { type: "string", description: "可选：模板文件路径" },
    },
    required: ["slides", "outputPath"],
  },
  execute: async (args) => {
    const slides = args.slides as any[];
    const outPath = String(args.outputPath);
    const tplPath = args.templatePath ? String(args.templatePath) : null;
    const themeName = (args as any).theme as string || "business";
    if (!Array.isArray(slides) || slides.length === 0) return "请提供 slides 数组";
    try {
      const PptxGenJS = require("pptxgenjs");
      const pres = new PptxGenJS();

      // 内置主题配色
      const themes: Record<string, { bg: string; titleColor: string; textColor: string; accent: string }> = {
        business:  { bg: "FFFFFF", titleColor: "1a3c6e", textColor: "333333", accent: "2e75b6" },
        modern:    { bg: "FFFFFF", titleColor: "2d3436", textColor: "636e72", accent: "0984e3" },
        warm:      { bg: "FFF8F0", titleColor: "c0392b", textColor: "555555", accent: "e67e22" },
        dark:      { bg: "2c3e50", titleColor: "ecf0f1", textColor: "bdc3c7", accent: "3498db" },
        minimal:   { bg: "FFFFFF", titleColor: "111111", textColor: "666666", accent: "999999" },
        creative:  { bg: "FFFFFF", titleColor: "6c5ce7", textColor: "444444", accent: "fd79a8" },
      };
      const theme = themes[themeName] || themes.business;

      // 如果有模板，先加载
      if (tplPath && fs.existsSync(tplPath)) {
        try { fs.readFileSync(tplPath); } catch { /* ignore */ }
      }

      const colors = [theme.accent, "e17055", "00b894", "6c5ce7", "0984e3", "fd79a8"];
      for (let i = 0; i < slides.length; i++) {
        const s = slides[i];
        const slide = pres.addSlide();
        const layout = s.layout || s.size || "content";
        slide.background = { fill: theme.bg };

        // 通用顶部线
        slide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 0.05, fill: { color: theme.accent } });

        if (layout === "cover") {
          // 封面：左侧色块 + 右侧标题
          slide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 3.5, h: "100%", fill: { color: theme.accent } });
          slide.addShape(pres.ShapeType.rect, { x: 3.5, y: 0, w: 6.5, h: "100%", fill: { color: theme.bg } });
          if (s.title) slide.addText(s.title, { x: 4, y: 1.5, w: 5.5, h: 1.5, fontSize: 38, bold: true, color: theme.titleColor });
          slide.addShape(pres.ShapeType.rect, { x: 4, y: 3.1, w: 2, h: 0.05, fill: { color: theme.accent } });
          if (s.subtitle) slide.addText(s.subtitle, { x: 4, y: 3.3, w: 5, h: 0.7, fontSize: 18, color: theme.textColor });
          if (s.author) slide.addText(s.author, { x: 4, y: 4.2, w: 5, h: 0.5, fontSize: 13, color: "999999" });
        } else if (layout === "closing") {
          // 总结页
          slide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: "100%", h: "100%", fill: { color: theme.accent, transparency: 95 } });
          slide.addShape(pres.ShapeType.ellipse, { x: 3, y: 0.5, w: 4, h: 1.5, fill: { color: theme.accent, transparency: 90 } });
          if (s.title) slide.addText(s.title, { x: 3, y: 0.6, w: 4, h: 1.3, fontSize: 32, bold: true, color: theme.titleColor, align: "center", valign: "middle" });
          if (s.bullets && s.bullets.length > 0) {
            slide.addText(
              s.bullets.map((b, bi) => "●  " + b),
              { x: 1.5, y: 2.2, w: 7, h: 0.6, fontSize: 16, color: theme.textColor, align: "center", paraSpaceAfter: 8 }
            );
          }
        } else if (layout === "chart") {
          // 图表：PptxGenJS 内置图表
          if (s.title) slide.addText(s.title, { x: 0.7, y: 0.3, w: "87%", h: 0.8, fontSize: 24, bold: true, color: theme.titleColor });
          if (s.chartData && s.chartType) {
            try {
              slide.addChart(pres.Charts[s.chartType] || pres.Charts.bar, s.chartData, {
                x: 1, y: 1.3, w: 8, h: 4,
                showTitle: false, showLegend: true,
                chartColors: colors,
              });
            } catch { /* chart fails silently */ }
          }
        } else if (layout === "table") {
          // 表格
          if (s.title) slide.addText(s.title, { x: 0.7, y: 0.3, w: "87%", h: 0.8, fontSize: 24, bold: true, color: theme.titleColor });
          if (s.tableData && s.tableData.length > 0) {
            const rows: any[] = s.tableData.map((row: string[], ri: number) =>
              row.map((cell: string) => ({ text: cell, options: { fontSize: 12, bold: ri === 0, color: ri === 0 ? "FFFFFF" : theme.textColor, fill: { color: ri === 0 ? theme.accent : (ri % 2 === 0 ? theme.bg : "F5F5F5") }, align: "center", valign: "middle" } }))
            );
            slide.addTable(rows, { x: 0.8, y: 1.3, w: 8.5, border: { type: "solid", pt: 0.5, color: "DDDDDD" }, colW: s.colWidths, rowH: 0.5 });
          }
        } else if (layout === "three-cards") {
          // 三栏卡片：圆形图 + 数字 + 标题
          const cardW = 2.8, gap = 0.3;
          for (let ci = 0; ci < 3; ci++) {
            const card = s.cards?.[ci] || {};
            const cx = 0.5 + ci * (cardW + gap);
            slide.addShape(pres.ShapeType.roundRect, { x: cx, y: 1.0, w: cardW, h: 4, fill: { color: "FFFFFF" }, shadow: { type: "outer", blur: 6, offset: 2, color: "000000", opacity: 0.1 }, rectRadius: 0.15 });
            slide.addShape(pres.ShapeType.ellipse, { x: cx + 0.7, y: 1.3, w: 1.4, h: 1.4, fill: { color: colors[ci], transparency: 85 } });
            if (card.num) slide.addText(card.num, { x: cx + 0.7, y: 1.4, w: 1.4, h: 1.2, fontSize: 28, bold: true, color: colors[ci], align: "center", valign: "middle" });
            if (card.title) slide.addText(card.title, { x: cx + 0.2, y: 3.0, w: cardW - 0.4, h: 0.5, fontSize: 15, bold: true, color: theme.titleColor, align: "center" });
            if (card.desc) slide.addText(card.desc, { x: cx + 0.3, y: 3.5, w: cardW - 0.6, h: 1.2, fontSize: 11, color: theme.textColor, align: "center" });
          }
        } else if (layout === "big-number") {
          slide.addShape(pres.ShapeType.ellipse, { x: 3, y: 0.8, w: 4, h: 4, fill: { color: theme.accent, transparency: 88 } });
          slide.addShape(pres.ShapeType.ellipse, { x: 3.5, y: 1.3, w: 3, h: 3, fill: { color: theme.accent, transparency: 75 } });
          if (s.num) slide.addText(s.num, { x: 3.5, y: 1.5, w: 3, h: 1.8, fontSize: 56, bold: true, color: theme.accent, align: "center", valign: "middle" });
          if (s.title) slide.addText(s.title, { x: 1.5, y: 3.8, w: 7, h: 0.6, fontSize: 20, bold: true, color: theme.titleColor, align: "center" });
          if (s.bullets?.[0]) slide.addText(s.bullets[0], { x: 2, y: 4.3, w: 6, h: 0.5, fontSize: 13, color: theme.textColor, align: "center" });
        } else if (layout === "image-text") {
          // 图片占位 + 右侧文字
          slide.addShape(pres.ShapeType.roundRect, { x: 0.5, y: 1.2, w: 4, h: 3.6, fill: { color: "EEEEEE" }, rectRadius: 0.1 });
          slide.addText("📷", { x: 0.5, y: 2.2, w: 4, h: 1, fontSize: 40, align: "center", color: "CCCCCC" });
          if (s.title) slide.addText(s.title, { x: 5, y: 1.2, w: 4.5, h: 0.8, fontSize: 24, bold: true, color: theme.titleColor });
          if (s.bullets && s.bullets.length > 0) {
            slide.addText(
              s.bullets.map((b: string) => ({ text: b, options: { bullet: true, bulletColor: theme.accent, fontSize: 14, color: theme.textColor, lineSpacing: 30, paraSpaceAfter: 6 } })),
              { x: 5, y: 2.2, w: 4.5, h: 2.8 }
            );
          }
        } else if (layout === "process") {
          // 流程：圆角矩形 + 箭头连接
          const steps = s.steps || s.bullets || [];
          const stepCount = Math.min(steps.length, 5);
          const stepW = 1.5, gap = 0.5;
          const totalW = stepCount * stepW + (stepCount - 1) * gap;
          const startX = (10 - totalW) / 2;
          if (s.title) slide.addText(s.title, { x: 0.8, y: 0.3, w: 8.4, h: 0.7, fontSize: 24, bold: true, color: theme.titleColor, align: "center" });
          for (let pi = 0; pi < stepCount; pi++) {
            const px = startX + pi * (stepW + gap);
            // 圆角矩形
            slide.addShape(pres.ShapeType.roundRect, { x: px, y: 1.3, w: stepW, h: 1.0, fill: { color: colors[pi % colors.length] }, rectRadius: 0.1, shadow: { type: "outer", blur: 4, offset: 1, color: "000000", opacity: 0.15 } });
            slide.addText(steps[pi], { x: px + 0.1, y: 1.3, w: stepW - 0.2, h: 1.0, fontSize: 12, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
            // 编号圆
            slide.addShape(pres.ShapeType.ellipse, { x: px + stepW / 2 - 0.18, y: 2.6, w: 0.36, h: 0.36, fill: { color: colors[pi % colors.length] } });
            slide.addText(`${pi + 1}`, { x: px + stepW / 2 - 0.18, y: 2.6, w: 0.36, h: 0.36, fontSize: 11, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
            // 箭头连接（除最后一个）
            if (pi < stepCount - 1) {
              slide.addShape(pres.ShapeType.line, {
                x: px + stepW, y: 1.8, w: gap, h: 0,
                line: { color: theme.accent, width: 2, endArrowType: "triangle" }
              });
            }
          }
          // 底部连接线
          slide.addShape(pres.ShapeType.line, { x: startX + stepW / 2, y: 2.78, w: totalW - stepW, h: 0, line: { color: theme.accent, width: 1.5, dashType: "dash" } });
        } else if (layout === 'roadmap') {
          // 时间轴路线图：圆点 + 竖线/箭头 + 文字
          const items = s.milestones || s.bullets || [];
          const mCount = Math.min(items.length, 6);
          const mStepW = 9 / (mCount - 1);
          slide.addShape(pres.ShapeType.line, { x: 0.5, y: 2.5, w: 9, h: 0, line: { color: theme.accent, width: 3, endArrowType: 'triangle' } });
          for (let mi = 0; mi < mCount; mi++) {
            const mx = 0.5 + mi * mStepW;
            const side = mi % 2 === 0;
            slide.addShape(pres.ShapeType.ellipse, { x: mx - 0.2, y: 2.3, w: 0.4, h: 0.4, fill: { color: colors[mi % colors.length] } });
            slide.addText(items[mi], { x: mx - 0.6, y: side ? 1.3 : 2.9, w: 1.8, h: 1.0, fontSize: 11, color: theme.textColor, align: 'center', valign: 'middle' });
            if (mi < mCount - 1) {
              slide.addShape(pres.ShapeType.line, { x: mx + 0.2, y: 2.5, w: mStepW - 0.4, h: 0, line: { color: theme.accent, width: 2, endArrowType: 'triangle' } });
            }
          }
          if (s.title) slide.addText(s.title, { x: 0.8, y: 0.3, w: 8.4, h: 0.7, fontSize: 26, bold: true, color: theme.titleColor, align: 'center' });

        } else {
          // content: 默认正文 + icon bullets
          if (s.title) {
            slide.addText(s.title, { x: 0.7, y: 0.3, w: "87%", h: 0.9, fontSize: 26, bold: true, color: theme.titleColor });
            slide.addShape(pres.ShapeType.rect, { x: 0.7, y: 1.15, w: 2, h: 0.05, fill: { color: theme.accent } });
          }
          if (s.bullets && s.bullets.length > 0) {
            const bullets: any[] = [];
            s.bullets.forEach((b: string, bi: number) => {
              bullets.push({ text: b, options: { bullet: { code: "25CF" }, bulletColor: colors[bi % colors.length], fontSize: 15, color: theme.textColor, lineSpacing: 34, paraSpaceAfter: 6 } });
            });
            slide.addText(bullets, { x: 0.9, y: 1.5, w: "82%", h: 3.8 });
          }
          slide.addText(`${i + 1}`, { x: 9.2, y: 5.2, w: 0.6, h: 0.4, fontSize: 9, color: theme.accent, align: "right" });
        }
      }

      // 确保输出目录存在
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      await pres.writeFile({ fileName: outPath });
      return "✅ PPT 已生成: " + outPath + " (共 " + slides.length + " 页, 主题: " + themeName + ")";
    } catch (e: any) {
      return "创建 PPT 失败: " + e.message;
    }
  },
};


// ===== fill-template =====

export const fillTemplateTool: ToolDef = {
  name: "fill-template",
  description: "将内容填入 PPTX 模板。读取模板的结构和设计，保留原配色/字体/背景，只替换文本内容。用于套用精美模板批量生成PPT。",
  input_examples: [
    { description: "用模板生成PPT", args: {
      templatePath: "C:\Users\asus\Templates\公司模板.pptx",
      slides: [{ title: "季度总结", bullets: ["收入+20%", "用户破百万"] }],
      outputPath: "C:\Users\asus\Desktop\汇报.pptx"
    }},
  ],
  parameters: {
    type: "object",
    properties: {
      templatePath: { type: "string", description: "模板 PPTX 文件路径" },
      slideMap: { type: "array", description: "每页指定 { templateSlide: 数字(从1开始), title, bullets }。templateSlide 选择模板中哪一页的布局来克隆" },
      outputPath: { type: "string", description: "输出 .pptx 文件路径" },
    },
    required: ["templatePath", "slideMap", "outputPath"],
  },
  execute: async (args) => {
    const tplPath = String(args.templatePath);
    const slideMap = args.slideMap as any[];
    const outPath = String(args.outputPath);
    if (!fs.existsSync(tplPath)) return "模板文件不存在: " + tplPath;
    if (!Array.isArray(slideMap) || slideMap.length === 0) return "请提供 slideMap 数组";
    try {
      // 原地替换：直接修改模板文件，不改变 slide 数量
      fs.copyFileSync(tplPath, outPath);
      const zip = new AdmZip(outPath);
      const slideEntries = zip.getEntries().filter(e =>
        e.entryName.startsWith("ppt/slides/slide") && e.entryName.endsWith(".xml")
      ).sort((a, b) => {
        const na = parseInt(a.entryName.match(/slide(d+)/)?.[1] || "0");
        const nb = parseInt(b.entryName.match(/slide(d+)/)?.[1] || "0");
        return na - nb;
      });
      const aTre = new RegExp("<a:t[^>]*>([^<]*)<\/a:t>", "g");
      for (let i = 0; i < Math.min(slideMap.length, slideEntries.length); i++) {
        const sm = slideMap[i];
        const tplIdx = (sm.templateSlide || (i + 1)) - 1;
        if (tplIdx < 0 || tplIdx >= slideEntries.length) continue;
        let xml = slideEntries[tplIdx].getData().toString("utf-8");
        const texts: string[] = [];
        if (sm.title) texts.push(sm.title);
        if (sm.bullets && Array.isArray(sm.bullets)) texts.push(...sm.bullets);
        if (texts.length > 0) {
          let ti = 0;
          xml = xml.replace(aTre, (match, old) => {
            if (ti < texts.length) return match.replace(old, texts[ti++]);
            return match;
          });
          zip.updateFile(slideEntries[tplIdx].entryName, Buffer.from(xml, "utf-8"));
        }
      }
      zip.writeZip(outPath);
      return `✅ 模板套用完成: ${outPath} (从 ${slideEntries.length} 页模板中填充了 ${Math.min(slideMap.length, slideEntries.length)} 页)`;
    } catch (e: any) {
      return "模板填充失败: " + e.message;
    }
  },
};
