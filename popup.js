(() => {
  "use strict";

  const { storageKeys: STORAGE_KEYS, defaults: DEFAULTS, limits: LIMITS } =
    globalThis.WIDEN_POPUP_WIDTH_SETTINGS;

  const form = {
    commentWidth: document.getElementById("commentWidth"),
    blameWidth: document.getElementById("blameWidth"),
    save: document.getElementById("save"),
    reset: document.getElementById("reset"),
    status: document.getElementById("status"),
  };

  const normalizeWidth = (key, value) => {
    const width = Number.parseInt(String(value), 10);
    if (!Number.isFinite(width)) return null;

    const { min, max } = LIMITS[key];
    return Math.min(max, Math.max(min, Math.round(width)));
  };

  const setStatus = (message, isError = false) => {
    form.status.textContent = message;
    form.status.classList.toggle("error", isError);
  };

  const setFormValues = (settings) => {
    form.commentWidth.value = String(settings.commentWidth);
    form.blameWidth.value = String(settings.blameWidth);
  };

  const applyInputLimits = () => {
    form.commentWidth.min = String(LIMITS.commentWidth.min);
    form.commentWidth.max = String(LIMITS.commentWidth.max);
    form.blameWidth.min = String(LIMITS.blameWidth.min);
    form.blameWidth.max = String(LIMITS.blameWidth.max);
  };

  const readSettings = () =>
    chrome.storage.sync.get(Object.values(STORAGE_KEYS)).then((items) => ({
      commentWidth:
        normalizeWidth("commentWidth", items[STORAGE_KEYS.commentWidth]) ??
        DEFAULTS.commentWidth,
      blameWidth:
        normalizeWidth("blameWidth", items[STORAGE_KEYS.blameWidth]) ??
        DEFAULTS.blameWidth,
    }));

  const readFormValues = () => {
    const commentWidth = normalizeWidth(
      "commentWidth",
      form.commentWidth.value,
    );
    const blameWidth = normalizeWidth("blameWidth", form.blameWidth.value);

    if (commentWidth === null || blameWidth === null) {
      throw new Error("幅は数値で入力してください。");
    }

    return {
      commentWidth,
      blameWidth,
    };
  };

  const saveSettings = async (settings) => {
    await chrome.storage.sync.set({
      [STORAGE_KEYS.commentWidth]: settings.commentWidth,
      [STORAGE_KEYS.blameWidth]: settings.blameWidth,
    });
    setFormValues(settings);
  };

  const initialize = async () => {
    try {
      applyInputLimits();
      setFormValues(await readSettings());
      setStatus("");
    } catch {
      setStatus("設定を読み込めませんでした。", true);
    }
  };

  form.save.addEventListener("click", async () => {
    try {
      const settings = readFormValues();
      await saveSettings(settings);
      setStatus("保存しました。");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "保存できませんでした。",
        true,
      );
    }
  });

  form.reset.addEventListener("click", async () => {
    try {
      await chrome.storage.sync.remove(Object.values(STORAGE_KEYS));
      setFormValues(DEFAULTS);
      setStatus("リセットしました。");
    } catch {
      setStatus("リセットできませんでした。", true);
    }
  });

  initialize();
})();
