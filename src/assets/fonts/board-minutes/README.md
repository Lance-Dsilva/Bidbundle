# Board minutes fonts

These unmodified Noto fonts are bundled for portable, offline server PDF generation and embedded as subsets in each exported PDF. They require no operating-system fonts or runtime downloads.

- `NotoSans-Regular.ttf`: https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf
- `NotoSansCJKsc-Regular.otf`: https://github.com/notofonts/noto-cjk/blob/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf

Both are under the SIL Open Font License 1.1; preserve the accompanying `OFL.txt` and `OFL-CJK.txt`. The CJK font supplies Chinese, Japanese and Korean glyphs; Noto Sans supplies Latin, Greek and Cyrillic. Unsupported glyphs are rejected explicitly rather than replaced or silently omitted. Additional scripts require an appropriately licensed font and rendering verification.

The PDF route must include this directory in Next.js output file tracing so the fonts are available in a serverless deployment.
