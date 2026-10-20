# Hero artwork regression checks

The previous desktop background used an unbounded portrait-image zoom and a
separate 1500px sizing rule. At 1743px the image's left edge became a hard seam,
and the lighthouse base and waterfront were cropped out. The old desktop WebP
also has a truncated RIFF payload (7,518 bytes rather than the declared 22,210)
and cannot decode; a successful HTTP response did not catch that failure.

The home tablet and desktop artwork now occupies its own bounded box inside the content
shell. Its crop is continuous across viewport widths, its edges feather within
that box, and text occupies a separate column. The established mobile background
is retained. Fallback backgrounds use the existing valid portrait asset rather
than the truncated desktop file; the old file remains in history and is not
used as an active fallback.

`verify-ui.mjs` decodes local CSS artwork and the home illustration. It captures
390, 641, 768, 900, 901, 1180, 1440, 1499, 1500 and 1743px viewports. Desktop assertions
check text separation, overflow, image bounds, source landmark crop and continuity
around 1500px. Release review must inspect the screenshots, not treat a passing
geometry assertion as proof of visual quality.
