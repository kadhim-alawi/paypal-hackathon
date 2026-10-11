// Tideover Ledger: the treasurer's spreadsheet, built on AG Grid.
// Mounted by the Flutter staff console (HtmlElementView) through window.tideoverLedger.
// "Ask the ledger" uses AG Grid's AI Toolkit: the grid describes its own state as a
// JSON Schema, Claude answers within it, and the answer is applied with setState().
(function () {
  "use strict";

  const BUNDLE_LOCAL = "ledger/aggrid.js"; // built by tools/aggrid (see README)
  const BUNDLE_CDN = "https://cdn.jsdelivr.net/npm/ag-grid-enterprise@36.2.0/dist/ag-grid-enterprise.min.js";
  const AI_FEATURES = ["aggregation", "filter", "sort", "pivot", "columnVisibility", "rowGroup"];

  let loading = null;
  let api = null;
  let opts = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Couldn't load " + src));
      document.head.appendChild(s);
    });
  }

  function loadAgGrid() {
    if (window.agGrid) return Promise.resolve(window.agGrid);
    loading ??= loadScript(BUNDLE_LOCAL)
      .catch(() => loadScript(BUNDLE_CDN))
      .then(() => {
        if (!window.agGrid) throw new Error("AG Grid didn't load");
        return window.agGrid;
      });
    return loading;
  }

  function injectFonts() {
    if (document.getElementById("tideover-ledger-fonts")) return;
    const style = document.createElement("style");
    style.id = "tideover-ledger-fonts";
    style.textContent = [400, 500, 600, 700]
      .map((w) => {
        const file = { 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold" }[w];
        return `@font-face{font-family:"Inter";font-weight:${w};src:url("assets/assets/fonts/Inter-${file}.otf") format("opentype");}`;
      })
      .join("");
    document.head.appendChild(style);
  }

  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const money = (p) => (p.value == null || p.value === "" ? "" : usd.format(p.value));
  const signedMoney = (p) => (p.value == null || p.value === "" ? "" : (p.value > 0 ? "+" : p.value < 0 ? "−" : "") + usd.format(Math.abs(p.value)));

  // Column descriptions also go to Claude via getStructuredSchema().
  const COLUMN_HINTS = {
    date: { description: "Date the money moved (YYYY-MM-DD)" },
    month: { description: "Year and month, e.g. 2026-10; group by this for monthly totals", includeSetValues: true },
    fund: { description: "Which community fund", includeSetValues: true },
    type: { description: "Kind of movement: Donation, Grant (paid to a person through PayPal Payouts), PayPal fees, Refund, Returned grant, Adjustment", includeSetValues: true },
    direction: { description: "In (money received) or Out (money paid or fees)", includeSetValues: true },
    amount: { description: "Amount in US dollars, always positive" },
    net: { description: "Signed effect on the fund balance in dollars: positive in, negative out" },
    category: { description: "Need category for grants (e.g. rent, utilities); for donations, whether it funded a specific need", includeSetValues: true },
    party: { description: "Donor name, or the applicant's case for grants" },
    method: { description: "How money moved: PayPal checkout for donations; PayPal account, PayPal email or Venmo for grants", includeSetValues: true },
    channel: { description: "Web (donor on the site), AI agent (donated through Tideover's MCP server) or Staff", includeSetValues: true },
    caseRef: { description: "Request reference such as TDO-7KQ4M" },
    paypalId: { description: "PayPal capture or payout transaction ID" },
    status: { description: "PayPal status of the donation or payout", includeSetValues: true },
  };

  function columnDefs() {
    const set = { filter: "agSetColumnFilter", enableRowGroup: true, enablePivot: true };
    return [
      { field: "date", headerName: "Date", cellDataType: "dateString", filter: "agDateColumnFilter", sort: "desc", width: 120 },
      { field: "month", headerName: "Month", ...set, hide: true, width: 110 },
      { field: "fund", headerName: "Fund", ...set, minWidth: 180 },
      { field: "type", headerName: "Type", ...set, width: 170 },
      { field: "direction", headerName: "In/Out", ...set, width: 118,
        cellClassRules: { "tdo-in": (p) => p.value === "In", "tdo-out": (p) => p.value === "Out" } },
      { field: "amount", headerName: "Amount", cellDataType: "number", filter: "agNumberColumnFilter", aggFunc: "sum", enableValue: true,
        valueFormatter: money, type: "rightAligned", width: 120 },
      { field: "net", headerName: "Net", cellDataType: "number", filter: "agNumberColumnFilter", aggFunc: "sum", enableValue: true,
        valueFormatter: signedMoney, type: "rightAligned", width: 120,
        cellClassRules: { "tdo-in": (p) => p.value > 0, "tdo-out": (p) => p.value < 0 } },
      { field: "category", headerName: "Category", ...set, minWidth: 170 },
      { field: "party", headerName: "Donor / recipient", filter: "agTextColumnFilter", enableRowGroup: true, minWidth: 170 },
      { field: "method", headerName: "Method", ...set, width: 150 },
      { field: "channel", headerName: "Channel", ...set, width: 110 },
      { field: "caseRef", headerName: "Case", filter: "agTextColumnFilter", width: 120 },
      { field: "paypalId", headerName: "PayPal ID", filter: "agTextColumnFilter", width: 190, cellClass: "tdo-mono" },
      { field: "status", headerName: "Status", ...set, width: 120 },
      { field: "memo", headerName: "Memo", filter: "agTextColumnFilter", hide: true, minWidth: 200 },
    ];
  }

  function totalsRow() {
    let amountIn = 0, amountOut = 0, net = 0, n = 0;
    api.forEachNodeAfterFilter((node) => {
      if (node.group || !node.data) return;
      n++;
      net += node.data.net;
      if (node.data.direction === "In") amountIn += node.data.amount; else amountOut += node.data.amount;
    });
    return [{ type: `${n} movements`, direction: "", amount: amountIn + amountOut, net: Math.round(net * 100) / 100,
      party: `In ${usd.format(amountIn)} · Out ${usd.format(amountOut)}` }];
  }

  function theme(agGrid) {
    return agGrid.themeQuartz.withParams({
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: 13,
      accentColor: "#0E7C66",
      backgroundColor: "#FFFFFF",
      foregroundColor: "#14211D",
      headerBackgroundColor: "#F6F4EF",
      headerFontWeight: 600,
      borderColor: "#E6E1D6",
      rowHoverColor: "#E2F1EC",
      selectedRowBackgroundColor: "#E2F1EC",
      chromeBackgroundColor: "#F6F4EF",
      wrapperBorderRadius: 14,
      spacing: 7,
    });
  }

  function injectStyles() {
    if (document.getElementById("tideover-ledger-style")) return;
    const style = document.createElement("style");
    style.id = "tideover-ledger-style";
    style.textContent = `.tdo-in{color:#0A5C4C;font-weight:600}.tdo-out{color:#B54708}.tdo-mono{font-family:ui-monospace,Menlo,monospace;font-size:12px}
      .ag-row-pinned{font-weight:600;background:#F6F4EF!important}`;
    document.head.appendChild(style);
  }

  async function fetchJson(path, init) {
    const res = await fetch(opts.apiBase + path, {
      ...init,
      headers: { authorization: "Bearer " + opts.token, "content-type": "application/json", ...(init && init.headers) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || "Request failed (" + res.status + ")");
    return body;
  }

  function pick(state, keys) {
    const out = {};
    for (const k of keys) if (state[k] !== undefined) out[k] = state[k];
    return out;
  }

  window.tideoverLedger = {
    /** Creates the grid inside `el` and loads the ledger. Resolves to the number of rows. */
    async mount(el, options) {
      opts = options;
      injectFonts();
      injectStyles();
      const agGrid = await loadAgGrid();
      if (opts.licenseKey) agGrid.LicenseManager.setLicenseKey(opts.licenseKey);
      const rows = await fetchJson("/api/staff/ledger");
      if (api) api.destroy();
      api = agGrid.createGrid(el, {
        theme: theme(agGrid),
        rowData: rows,
        getRowId: (p) => p.data.id,
        columnDefs: columnDefs(),
        defaultColDef: { sortable: true, resizable: true, filter: true, floatingFilter: false, minWidth: 90 },
        autoGroupColumnDef: { minWidth: 240, headerName: "Group" },
        rowGroupPanelShow: "always",
        groupDefaultExpanded: 0,
        suppressAggFuncInHeader: true,
        animateRows: true,
        sideBar: { toolPanels: ["columns", "filters"], hiddenByDefault: false, defaultToolPanel: null },
        statusBar: { statusPanels: [{ statusPanel: "agTotalAndFilteredRowCountComponent", align: "left" }] },
        pinnedBottomRowData: [],
        onModelUpdated: () => api && api.setGridOption("pinnedBottomRowData", totalsRow()),
        onGridReady: () => setTimeout(() => api && api.setGridOption("pinnedBottomRowData", totalsRow()), 0),
      });
      return rows.length;
    },

    /** "Ask the ledger": question → AG Grid AI Toolkit schema → Claude → setState. */
    async ask(question) {
      if (!api) throw new Error("Ledger isn't ready yet");
      const schema = this.schema();
      const full = api.getState();
      const res = await fetchJson("/api/staff/ledger/ask", {
        method: "POST",
        body: JSON.stringify({ question, schema, state: pick(full, AI_FEATURES) }),
      });
      const ignore = new Set(res.propertiesToIgnore || []);
      const next = { ...full };
      for (const key of AI_FEATURES) {
        if (ignore.has(key) || !(key in (res.gridState || {}))) continue;
        const value = res.gridState[key];
        if (value == null) delete next[key];
        else next[key] = value;
      }
      // Pivot needs pivot mode on, and grouping/pivot need value columns to total.
      api.setState(next);
      return { explanation: res.explanation || "", mode: res.mode || "" };
    },

    /** Back to every movement, newest first. */
    reset() {
      if (!api) return;
      const state = api.getState();
      for (const key of AI_FEATURES) delete state[key];
      state.sort = { sortModel: [{ colId: "date", sort: "desc" }] };
      api.setState(state);
      api.setGridOption("quickFilterText", "");
    },

    quickFilter(text) {
      if (api) api.setGridOption("quickFilterText", text || "");
    },

    exportCsv() {
      if (api) api.exportDataAsCsv({ fileName: "tideover-ledger.csv" });
    },

    exportExcel() {
      if (api) api.exportDataAsExcel({ fileName: "tideover-ledger.xlsx", sheetName: "Ledger" });
    },

    /** The AI Toolkit schema sent with each question (for tests and debugging). */
    schema() {
      return api ? api.getStructuredSchema({ exclude: ["columnSizing"], columns: COLUMN_HINTS }) : null;
    },

    /** Current state of the AI-controllable features (for tests and debugging). */
    state() {
      return api ? pick(api.getState(), AI_FEATURES) : null;
    },

    destroy() {
      if (api) api.destroy();
      api = null;
    },
  };
})();
