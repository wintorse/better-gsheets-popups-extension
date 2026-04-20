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

      if (iframe.contentDocument && iframe.contentDocument.readyState === "complete") {
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
    const overflowRight = rect.right - window.innerWidth + MARGIN + RIGHT_SIDEBAR_OFFSET;
    if (overflowRight > 0) {
      const currentLeft = parseFloat(el.style.left) || 0;
      el.style.setProperty("left", `${currentLeft - overflowRight}px`, "important");
    }
  };

  const clampAll = (root) => {
    root.querySelectorAll(".docos-anchoreddocoview").forEach(clampPosition);
  };

  const positionObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // style 属性の変化（Google SpreadsheetがleftをinlineStyleで設定する）
      if (mutation.type === "attributes" && mutation.attributeName === "style") {
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
        node.querySelectorAll?.(".docos-anchoreddocoview").forEach(clampPosition);
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
})();
