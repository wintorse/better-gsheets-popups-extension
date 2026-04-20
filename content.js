(() => {
  const STYLE_ID = "spreadsheet-wide-comment-style";

  const css = `
    .docos-anchoreddocoview {
      width: 32vw !important;
      min-width: 240px !important;
      max-width: none !important;
    }
    .docos-anchoreddocoview-internal,
    .docos-anchoreddocoview-content,
    .docos-docoview-replycontainer {
      width: 100% !important;
      max-width: none !important;
    }
    .docos-docoview-input-pane,
    .docos-input-textarea {
      width: 100% !important;
      box-sizing: border-box !important;
    }
    .docos-replyview-body {
      word-wrap: break-word !important;
      white-space: pre-wrap !important;
    }
  `;

  const injectStyle = (doc) => {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    (doc.head || doc.documentElement).appendChild(style);
  };

  // メインドキュメントに注入
  injectStyle(document);

  // iframe にも注入するため MutationObserver で監視
  const observeIframes = (root) => {
    const injectToIframe = (iframe) => {
      const tryInject = () => {
        try {
          const iframeDoc = iframe.contentDocument;
          if (iframeDoc) {
            injectStyle(iframeDoc);
            // iframe 内の更なる iframe も監視
            observeIframes(iframeDoc);
          }
        } catch {
          // cross-origin iframe はスキップ
        }
      };

      if (
        iframe.contentDocument &&
        iframe.contentDocument.readyState === "complete"
      ) {
        tryInject();
      } else {
        iframe.addEventListener("load", tryInject);
      }
    };

    // 既存の iframe に注入
    root.querySelectorAll("iframe").forEach(injectToIframe);

    // 新たに追加される iframe を監視
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.tagName === "IFRAME") {
            injectToIframe(node);
          }
          node.querySelectorAll?.("iframe").forEach(injectToIframe);
        }
      }
    });

    observer.observe(root, { childList: true, subtree: true });
  };

  observeIframes(document);

  // コメントウィンドウが右端を超えないよう left を補正する
  const MARGIN = 16; // マージンとスクロールバー分を考慮した px
  const RIGHT_SIDEBAR_OFFSET = 56; // 右端メニューバー（56px）分

  const clampPosition = (el) => {
    const rect = el.getBoundingClientRect();
    const overflowRight =
      rect.right - window.innerWidth + MARGIN + RIGHT_SIDEBAR_OFFSET;
    if (overflowRight > 0) {
      const currentLeft = parseFloat(el.style.left) || 0;
      el.style.setProperty(
        "left",
        `${currentLeft - overflowRight}px`,
        "important",
      );
    }
  };

  const clampAll = (root) => {
    root.querySelectorAll(".docos-anchoreddocoview").forEach(clampPosition);
  };

  const positionObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // style 属性の変化（Google SpreadsheetがleftをinlineStyleで設定する）
      if (
        mutation.type === "attributes" &&
        mutation.attributeName === "style"
      ) {
        const el = mutation.target;
        if (el.classList.contains("docos-anchoreddocoview")) {
          clampPosition(el);
        }
      }
      // 新しく追加されたコメントウィンドウ
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.classList?.contains("docos-anchoreddocoview")) {
          clampPosition(node);
        }
        node
          .querySelectorAll?.(".docos-anchoreddocoview")
          .forEach(clampPosition);
      }
    }
  });

  const observePositionInDoc = (doc) => {
    try {
      if (!doc) return;
      clampAll(doc);
      positionObserver.observe(doc.body || doc.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style"],
      });
    } catch {
      // cross-origin iframe はスキップ
    }
  };

  observePositionInDoc(document);

  // iframe 内のコメントウィンドウにも適用
  const observePositionInIframes = (root) => {
    root.querySelectorAll("iframe").forEach((iframe) => {
      const tryObserve = () => {
        try {
          observePositionInDoc(iframe.contentDocument);
        } catch {}
      };
      if (iframe.contentDocument?.readyState === "complete") {
        tryObserve();
      } else {
        iframe.addEventListener("load", tryObserve);
      }
    });
  };

  observePositionInIframes(document);

  // ── 編集履歴ポップアップ: 差分をgit-diff風に再描画 ───────────────────────

  const BLAME_DIFF_ATTR = "data-widen-diff-rendered";

  const blameDiffCSS = `
    .widen-diff-block {
      margin-top: 6px;
      font-size: 12px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-all;
      border-radius: 3px;
      overflow: hidden;
    }
    .widen-diff-del {
      background: #ffeef0;
      color: #b31d28;
      padding: 4px 8px;
      display: block;
      border-left: 3px solid #f97583;
      font-style: normal !important;
    }
    .widen-diff-add {
      background: #e6ffed;
      color: #22863a;
      padding: 4px 8px;
      display: block;
      border-left: 3px solid #34d058;
      font-style: normal !important;
    }
    .widen-diff-neutral {
      background: #f6f8fa;
      color: #24292e;
      padding: 4px 8px;
      display: block;
      border-left: 3px solid #959da5;
      font-style: normal !important;
    }
  `;

  const injectBlameDiffStyle = (doc) => {
    const id = "widen-ext-blame-diff-style";
    if (!doc || doc.getElementById(id)) return;
    const style = doc.createElement("style");
    style.id = id;
    style.textContent = blameDiffCSS;
    (doc.head || doc.documentElement).appendChild(style);
  };

  injectBlameDiffStyle(document);

  // valueContent 内から旧テキスト・新テキストを抽出してgit-diff風に再描画
  const transformDiff = (valueContent) => {
    if (valueContent.hasAttribute(BLAME_DIFF_ATTR)) return;

    // 直下テキストノードを順にたどる
    const childNodes = Array.from(valueContent.childNodes);
    // 引用符を除去する
    const strip = (s) => s.trim().replace(/^["「]|["」]$/g, "");

    // 「からX」パターン: boldSpan(置き換えました:) + textNode(旧) + boldSpan(から) + textNode(新)
    const boldSpans = childNodes.filter(
      (n) =>
        n.nodeType === Node.ELEMENT_NODE &&
        n.classList?.contains("docs-blame-bold-text"),
    );

    // ── パターンA: span(置き換えました:) + textNode(旧) + span(から) + textNode(新) ──
    // 「から」を含むspanを探してパターン確認
    const fromSpan = boldSpans.find((s) => s.textContent?.trim() === "から");
    if (fromSpan) {
      const fromSpanIdx = childNodes.indexOf(fromSpan);
      // 「から」の直前のテキストノードが旧テキスト、直後が新テキスト
      const oldTextNode = childNodes
        .slice(0, fromSpanIdx)
        .reverse()
        .find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      const newTextNode = childNodes
        .slice(fromSpanIdx + 1)
        .find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());

      if (!oldTextNode || !newTextNode) return;

      const oldText = strip(oldTextNode.textContent);
      const newText = strip(newTextNode.textContent);

      // マーク済みにしてから再描画
      valueContent.setAttribute(BLAME_DIFF_ATTR, "1");

      // アクションラベル（「置き換えました:」など）だけ残して後ろを差し替える
      const actionSpan = boldSpans.find((s) => s !== fromSpan);
      // 「から」以降の既存ノードを削除
      const toRemove = childNodes.filter((n) => {
        const idx = childNodes.indexOf(n);
        // actionSpan より後ろを全部削除
        return actionSpan ? idx > childNodes.indexOf(actionSpan) : true;
      });
      toRemove.forEach((n) => n.parentNode?.removeChild(n));

      // git-diff ブロックを追加
      const block = valueContent.ownerDocument.createElement("div");
      block.className = "widen-diff-block";
      const delLine = valueContent.ownerDocument.createElement("span");
      delLine.className = "widen-diff-del";
      delLine.textContent = "– " + oldText;
      const addLine = valueContent.ownerDocument.createElement("span");
      addLine.className = "widen-diff-add";
      addLine.textContent = "+ " + newText;
      block.appendChild(delLine);
      block.appendChild(addLine);
      valueContent.appendChild(block);
      return;
    }

    // ── パターンB: span(追加しました: / 削除しました:) + textNode(テキスト) ──
    if (boldSpans.length === 1) {
      const actionSpan = boldSpans[0];
      const actionText = actionSpan.textContent ?? "";
      const textNode = childNodes
        .slice(childNodes.indexOf(actionSpan) + 1)
        .find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());

      if (!textNode) return;

      const content = strip(textNode.textContent);
      // マーク済みにしてから再描画
      valueContent.setAttribute(BLAME_DIFF_ATTR, "1");

      // actionSpan より後ろを削除
      const toRemove = childNodes.filter(
        (n) => childNodes.indexOf(n) > childNodes.indexOf(actionSpan),
      );
      toRemove.forEach((n) => n.parentNode?.removeChild(n));

      // git-diff ブロックを追加（追加/削除の判別が難しいためグレーで統一）
      const block = valueContent.ownerDocument.createElement("div");
      block.className = "widen-diff-block";
      const line = valueContent.ownerDocument.createElement("span");
      line.className = "widen-diff-neutral";
      line.textContent = content;
      block.appendChild(line);
      valueContent.appendChild(block);
    }
  };

  const observeDiff = (root) => {
    injectBlameDiffStyle(root.ownerDocument || root);

    // 既存要素に適用
    root
      .querySelectorAll(".docs-blameview-value-content")
      .forEach(transformDiff);

    // 動的に追加・更新される要素を監視
    const obs = new MutationObserver((mutations) => {
      const touched = new Set();
      for (const m of mutations) {
        const vc = m.target.closest?.(".docs-blameview-value-content") ?? null;
        if (vc) touched.add(vc);
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== Node.ELEMENT_NODE) return;
          if (n.classList?.contains("docs-blameview-value-content"))
            touched.add(n);
          n.querySelectorAll?.(".docs-blameview-value-content").forEach((el) =>
            touched.add(el),
          );
        });
      }
      touched.forEach((el) => {
        el.removeAttribute(BLAME_DIFF_ATTR); // 再描画許可
        transformDiff(el);
      });
    });

    try {
      obs.observe(root.body || root.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch {}
  };

  observeDiff(document);

  // ── 編集履歴ポップアップ（.waffle-blameview）リサイズハンドル ──────────────

  const BLAME_HANDLE_CLASS = "widen-ext-blame-handle";

  const blameHandleCSS = `
    .waffle-blameview {
      overflow: hidden !important;
      box-sizing: border-box !important;
    }
    .waffle-blameview > *:not(.${BLAME_HANDLE_CLASS}),
    .waffle-blameview * {
      max-height: none !important;
      box-sizing: border-box !important;
    }
    .waffle-blameview > *:not(.${BLAME_HANDLE_CLASS}) {
      min-height: 0 !important;
      overflow: auto !important;
      width: 100% !important;
    }
    .${BLAME_HANDLE_CLASS} {
      position: absolute;
      bottom: 0;
      right: 0;
      width: 18px;
      height: 18px;
      cursor: se-resize;
      z-index: 99999;
      box-sizing: border-box;
      background: transparent;
      display: flex;
      align-items: flex-end;
      justify-content: flex-end;
      padding: 2px;
      flex: none !important;
    }
    .${BLAME_HANDLE_CLASS} svg {
      pointer-events: none;
      opacity: 0.45;
      transition: opacity 0.15s;
    }
    .${BLAME_HANDLE_CLASS}:hover svg {
      opacity: 0.85;
    }
  `;

  const injectBlameHandleStyle = (doc) => {
    const id = "widen-ext-blame-handle-style";
    if (!doc || doc.getElementById(id)) return;
    const style = doc.createElement("style");
    style.id = id;
    style.textContent = blameHandleCSS;
    (doc.head || doc.documentElement).appendChild(style);
  };

  injectBlameHandleStyle(document);

  const addBlameResizeHandle = (el) => {
    if (el.querySelector(`.${BLAME_HANDLE_CLASS}`)) return;

    // position が static なら relative に昇格してハンドルを正しく配置する
    const computed = window.getComputedStyle(el);
    if (computed.position === "static") {
      el.style.position = "relative";
    }

    // 初期高さを設定
    el.style.setProperty("height", "200px", "important");

    const handle = document.createElement("div");
    handle.className = BLAME_HANDLE_CLASS;
    handle.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style="transform:rotate(90deg)">
        <line x1="13" y1="13" x2="1"  y2="1"  stroke="#555" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="13" y1="9"  x2="5"  y2="1"  stroke="#555" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="13" y1="5"  x2="9"  y2="1"  stroke="#555" stroke-width="1.5" stroke-linecap="round"/>
      </svg>`;
    el.appendChild(handle);

    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Pointer Capture でハンドル自身にポインターイベントを束縛する
      // → Google Sheets が stopPropagation しても確実に pointermove/pointerup を受け取れる
      handle.setPointerCapture(e.pointerId);

      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = el.offsetWidth;
      const startHeight = el.offsetHeight;

      const onPointerMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        const newWidth = Math.max(200, startWidth + dx);
        const newHeight = Math.max(120, startHeight + dy);

        el.style.setProperty("width", `${newWidth}px`, "important");
        el.style.setProperty("height", `${newHeight}px`, "important");
      };

      const onPointerUp = (ev) => {
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener("pointermove", onPointerMove);
        handle.removeEventListener("pointerup", onPointerUp);
        handle.removeEventListener("pointercancel", onPointerUp);
      };

      handle.addEventListener("pointermove", onPointerMove);
      handle.addEventListener("pointerup", onPointerUp);
      handle.addEventListener("pointercancel", onPointerUp);
    });
  };

  const observeBlameView = (root) => {
    // 既存の要素に適用
    root.querySelectorAll(".waffle-blameview").forEach(addBlameResizeHandle);

    // 動的に追加された要素を監視
    const obs = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.classList?.contains("waffle-blameview")) {
            addBlameResizeHandle(node);
          }
          node
            .querySelectorAll?.(".waffle-blameview")
            .forEach(addBlameResizeHandle);
        }
      }
    });

    try {
      obs.observe(root.body || root.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch {
      // cross-origin などは無視
    }
  };

  observeBlameView(document);

  // iframe 内にも適用
  document.querySelectorAll("iframe").forEach((iframe) => {
    const tryObserveBlame = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          injectBlameHandleStyle(doc);
          observeBlameView(doc);
        }
      } catch {}
    };
    if (iframe.contentDocument?.readyState === "complete") tryObserveBlame();
    else iframe.addEventListener("load", tryObserveBlame);
  });
})();
