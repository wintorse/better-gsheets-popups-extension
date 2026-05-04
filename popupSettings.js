(() => {
  "use strict";

  globalThis.WIDEN_POPUP_WIDTH_SETTINGS = {
    storageKeys: {
      commentWidth: "widen-ext-comment-default-width",
      blameWidth: "widen-ext-blame-default-width",
    },
    defaults: {
      commentWidth: 300,
      blameWidth: 320,
    },
    limits: {
      commentWidth: { min: 282, max: 1600 },
      blameWidth: { min: 240, max: 1600 },
    },
  };
})();
