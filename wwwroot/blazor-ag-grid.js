// AgGrid.Blazor JS interop (AG Grid v33 대응 버전)
// 원본: ebekker/blazor-ag-grid, glazkovalex/blazor-ag-grid (MIT)
// 필요: 이 스크립트보다 먼저 ag-grid-enterprise(또는 community) UMD 번들이 로드되어 전역 agGrid 가 있어야 한다.
window.BlazorAgGrid = {
    callbackMap: {},
    apiMap: {},
    debug: false,

    log: function () {
        if (BlazorAgGrid.debug) console.log.apply(console, arguments);
    },

    // ---------------------------------------------------------------------
    // Grid lifecycle
    // ---------------------------------------------------------------------
    createGrid: function (gridDiv, interopOptions, configScript) {
        if (typeof agGrid === 'undefined') {
            console.error("[AgGrid.Blazor] agGrid is not loaded. ag-grid-enterprise.min.js 를 먼저 로드하세요.");
            return;
        }
        BlazorAgGrid.ensureModules();

        var id = interopOptions.CallbackId;
        var op = interopOptions.Options || {};
        var cb = interopOptions.Callbacks;
        var ev = interopOptions.Events;
        var ds = op.datasource;

        // Remember for subsequent API calls
        BlazorAgGrid.callbackMap[id] = interopOptions;

        BlazorAgGrid.normalizeOptions(op);

        if (cb) BlazorAgGrid.createGrid_wrapCallbacks(op, cb);
        if (ev) BlazorAgGrid.createGrid_wrapEvents(op, ev);
        if (ds) BlazorAgGrid.createGrid_wrapDatasource(op, ds);

        if (configScript) {
            var fn = BlazorAgGrid.util_resolvePath(configScript);
            if (typeof fn === 'function') {
                fn.call(null, op);
            } else {
                console.error("[AgGrid.Blazor] configScript '" + configScript + "' could not be resolved; ABORTING");
                return;
            }
        }

        var api = agGrid.createGrid(gridDiv, op);
        BlazorAgGrid.apiMap[id] = api;
    },

    destroyGrid: function (id) {
        var api = BlazorAgGrid.apiMap[id];
        if (api && !api.isDestroyed()) api.destroy();
        delete BlazorAgGrid.apiMap[id];
        delete BlazorAgGrid.callbackMap[id];
    },

    // UMD 번들은 일반적으로 모든 모듈이 등록되어 있으나, 안전하게 한 번 더 등록한다.
    _modulesRegistered: false,
    ensureModules: function () {
        if (BlazorAgGrid._modulesRegistered) return;
        BlazorAgGrid._modulesRegistered = true;
        try {
            if (agGrid.ModuleRegistry) {
                var mods = [];
                if (agGrid.AllEnterpriseModule) mods.push(agGrid.AllEnterpriseModule);
                else if (agGrid.AllCommunityModule) mods.push(agGrid.AllCommunityModule);
                if (mods.length) agGrid.ModuleRegistry.registerModules(mods);
            }
            if (window.PortalAgGridLicenseKey && agGrid.LicenseManager) {
                agGrid.LicenseManager.setLicenseKey(window.PortalAgGridLicenseKey);
            }
        } catch (e) {
            console.warn("[AgGrid.Blazor] module registration skipped", e);
        }
    },

    // .NET 에서 넘어온 옵션을 v33 형태로 정리
    normalizeOptions: function (op) {
        // 기본 테마 (Theming API). 레거시 CSS 테마를 쓰려면 theme: "legacy" 지정
        if (!op.theme && agGrid.themeAlpine) op.theme = agGrid.themeAlpine;

        // 구버전 옵션명 매핑
        if (op.suppressCellSelection !== undefined) {
            if (op.suppressCellFocus === undefined) op.suppressCellFocus = op.suppressCellSelection;
            delete op.suppressCellSelection;
        }

        // rowIdField -> getRowId
        if (op.rowIdField) {
            var f = op.rowIdField;
            op.getRowId = function (p) { return String(p.data[f]); };
            delete op.rowIdField;
        }
        // dataPathField -> getDataPath
        if (op.dataPathField) {
            var pf = op.dataPathField;
            op.getDataPath = function (d) { return d[pf]; };
            delete op.dataPathField;
        }

        if (op.columnDefs) BlazorAgGrid.normalizeColumnDefs(op.columnDefs);
        if (op.defaultColDef) BlazorAgGrid.normalizeColumnDefs([op.defaultColDef]);

        // "fn:" 함수 참조 해석 (rowData 는 제외)
        for (var k in op) {
            if (k === 'rowData' || k === 'columnDefs' || k === 'defaultColDef' || k === 'datasource') continue;
            op[k] = BlazorAgGrid.util_resolveFns(op[k]);
        }
    },

    normalizeColumnDefs: function (cols) {
        for (var i = 0; i < cols.length; i++) {
            var c = cols[i];
            if (c.editableFn) {
                c.editable = BlazorAgGrid.util_resolveFnRef(c.editableFn);
                delete c.editableFn;
            }
            if (c.children) BlazorAgGrid.normalizeColumnDefs(c.children);
            for (var k in c) {
                if (k === 'children') continue;
                c[k] = BlazorAgGrid.util_resolveFns(c[k]);
            }
        }
    },

    // ---------------------------------------------------------------------
    // Callbacks / events / datasource
    // ---------------------------------------------------------------------
    createGrid_wrapDatasource: function (op, ds) {
        op.datasource = BlazorAgGrid.util_wrapDatasource(ds);
    },

    createGrid_wrapCallbacks: function (gridOptions, gridCallbacks) {
        // Blazor Server 에서는 동기 invokeMethod 를 사용할 수 없다.
        if (gridCallbacks.handlers && (gridCallbacks.handlers.GetRowNodeId || gridCallbacks.handlers.GetDataPath)) {
            console.warn("[AgGrid.Blazor] GridCallbacks(GetRowNodeId/GetDataPath) 는 Blazor Server 에서 지원되지 않습니다. GridOptions.RowIdField / DataPathField 를 사용하세요.");
        }
    },

    _rowEvent: function (event) {
        return {
            data: event.data,
            rowNodeId: event.node ? event.node.id : null,
            rowIndex: event.rowIndex,
            rowPinned: event.rowPinned,
            context: null,
            event: null
        };
    },

    _cellEvent: function (event) {
        var ev = BlazorAgGrid._rowEvent(event);
        ev.columnId = event.column ? event.column.getColId() : null;
        ev.field = event.colDef ? event.colDef.field : null;
        ev.value = event.value;
        // portal: 셀 안의 [data-ptl-action] 요소(편집/삭제 아이콘 등)를 클릭했으면 그 값을 넘긴다
        var target = event.event && event.event.target;
        var actionEl = target && target.closest ? target.closest('[data-ptl-action]') : null;
        ev.action = actionEl ? actionEl.getAttribute('data-ptl-action') : null;
        return ev;
    },

    createGrid_wrapEvents: function (gridOptions, gridEvents) {
        var h = gridEvents.handlers || {};
        var invoke = function (name, arg) {
            var ref = h[name].jsRef;
            return arg === undefined ? ref.invokeMethodAsync("Invoke") : ref.invokeMethodAsync("Invoke", arg);
        };

        if (h.CellClicked) {
            gridOptions.onCellClicked = function (event) { invoke("CellClicked", BlazorAgGrid._cellEvent(event)); };
        }
        if (h.CellDoubleClicked) {
            gridOptions.onCellDoubleClicked = function (event) { invoke("CellDoubleClicked", BlazorAgGrid._cellEvent(event)); };
        }
        if (h.RowClicked) {
            gridOptions.onRowClicked = function (event) { invoke("RowClicked", BlazorAgGrid._rowEvent(event)); };
        }
        if (h.RowDoubleClicked) {
            gridOptions.onRowDoubleClicked = function (event) { invoke("RowDoubleClicked", BlazorAgGrid._rowEvent(event)); };
        }
        if (h.SelectionChanged) {
            gridOptions.onSelectionChanged = function (event) {
                var mapped = event.api.getSelectedNodes().map(BlazorAgGrid.util_mapRowNode);
                invoke("SelectionChanged", mapped);
            };
        }
        if (h.CellValueChanged) {
            gridOptions.onCellValueChanged = function (event) {
                var ev = BlazorAgGrid._cellEvent(event);
                ev.oldValue = event.oldValue;
                ev.newValue = event.newValue;
                invoke("CellValueChanged", ev);
            };
        }
        if (h.RowValueChanged) {
            gridOptions.onRowValueChanged = function (event) { invoke("RowValueChanged", BlazorAgGrid._rowEvent(event)); };
        }
        if (h.CellEditingStarted) {
            gridOptions.onCellEditingStarted = function (event) { invoke("CellEditingStarted", BlazorAgGrid._cellEvent(event)); };
        }
        if (h.CellEditingStopped) {
            gridOptions.onCellEditingStopped = function (event) {
                var ev = BlazorAgGrid._cellEvent(event);
                ev.oldValue = event.oldValue;
                ev.newValue = event.newValue;
                invoke("CellEditingStopped", ev);
            };
        }
        if (h.RowEditingStarted) {
            gridOptions.onRowEditingStarted = function (event) { invoke("RowEditingStarted", BlazorAgGrid._rowEvent(event)); };
        }
        if (h.RowEditingStopped) {
            gridOptions.onRowEditingStopped = function (event) { invoke("RowEditingStopped", BlazorAgGrid._rowEvent(event)); };
        }
        if (h.FirstDataRendered) {
            gridOptions.onFirstDataRendered = function () { invoke("FirstDataRendered"); };
        }
        if (h.GridReady) {
            gridOptions.onGridReady = function () { invoke("GridReady"); };
        }
    },

    // ---------------------------------------------------------------------
    // API calls
    // ---------------------------------------------------------------------
    _api: function (callbackId) {
        var api = BlazorAgGrid.apiMap[callbackId];
        if (!api) throw new Error("[AgGrid.Blazor] grid api not found: " + callbackId);
        return api;
    },

    // 구버전 API 이름을 v33 으로 매핑
    _legacyCall: function (api, name, args) {
        switch (name) {
            case 'setRowData': return api.setGridOption('rowData', args[0]);
            case 'setDatasource': return api.setGridOption('datasource', args[0]);
            case 'sizeColumnsToFit': return api.sizeColumnsToFit();
            default:
                var fn = api[name];
                if (typeof fn !== 'function') throw new Error("[AgGrid.Blazor] unknown grid api: " + name);
                return fn.apply(api, args || []);
        }
    },

    gridOptions_callGridApi: function (callbackId, name, args) {
        BlazorAgGrid._legacyCall(BlazorAgGrid._api(callbackId), name, args || []);
    },

    // v31 부터 columnApi 는 gridApi 로 통합됨
    gridOptions_callColumnApi: function (callbackId, name, args) {
        BlazorAgGrid._legacyCall(BlazorAgGrid._api(callbackId), name, args || []);
    },

    callGridApiWithResult: function (callbackId, name, args) {
        return BlazorAgGrid._legacyCall(BlazorAgGrid._api(callbackId), name, args || []);
    },

    gridOptions_setDatasource: function (callbackId, ds) {
        var api = BlazorAgGrid._api(callbackId);
        var interop = BlazorAgGrid.callbackMap[callbackId];
        if (!ds) {
            api.setGridOption('datasource', interop.Options.datasource);
        } else {
            var nativeDS = BlazorAgGrid.util_wrapDatasource(ds);
            interop.Options.datasource = nativeDS;
            api.setGridOption('datasource', nativeDS);
        }
    },

    setDataValue: function (callbackId, rowNodeId, field, value) {
        var node = BlazorAgGrid._api(callbackId).getRowNode(rowNodeId);
        if (node) node.setDataValue(field, value);
    },

    getRowData: function (callbackId) {
        var rows = [];
        BlazorAgGrid._api(callbackId).forEachNode(function (n) { if (n.data) rows.push(n.data); });
        return rows;
    },

    getSelectedRows: function (callbackId) {
        return BlazorAgGrid._api(callbackId).getSelectedRows();
    },

    datasource_successCallback: function (callbackId, rowsThisBlock, lastRow) {
        var getRowsParams = BlazorAgGrid.callbackMap[callbackId];
        getRowsParams.successCallback(rowsThisBlock, lastRow);
        delete BlazorAgGrid.callbackMap[callbackId];
    },

    datasource_failCallback: function (callbackId) {
        var getRowsParams = BlazorAgGrid.callbackMap[callbackId];
        getRowsParams.failCallback();
        delete BlazorAgGrid.callbackMap[callbackId];
    },

    // ---------------------------------------------------------------------
    // utils
    // ---------------------------------------------------------------------
    util_wrapDatasource: function (ds) {
        return {
            getRows: function (getRowsParams) {
                var callbackId = BlazorAgGrid.util_genId();
                BlazorAgGrid.callbackMap[callbackId] = getRowsParams;
                ds.invokeMethodAsync('GetRows', {
                    startRow: getRowsParams.startRow,
                    endRow: getRowsParams.endRow,
                    sortModel: getRowsParams.sortModel,
                    filterModel: getRowsParams.filterModel,
                    callbackId: callbackId
                });
            },
            destroy: function () {
                ds.invokeMethodAsync('Destroy');
            }
        };
    },

    util_resolvePath: function (path) {
        var parts = path.split('.');
        var cur = window;
        for (var i = 0; i < parts.length; i++) {
            if (cur == null) return undefined;
            cur = cur[parts[i]];
        }
        return cur;
    },

    // "fn:Some.Global.fn" -> 함수 참조
    util_resolveFnRef: function (v) {
        if (typeof v === 'string' && v.indexOf('fn:') === 0) {
            var fn = BlazorAgGrid.util_resolvePath(v.substring(3));
            if (typeof fn !== 'function') console.error("[AgGrid.Blazor] function not found: " + v);
            return fn;
        }
        return v;
    },

    util_resolveFns: function (v) {
        if (typeof v === 'string') return BlazorAgGrid.util_resolveFnRef(v);
        if (Array.isArray(v)) {
            for (var i = 0; i < v.length; i++) v[i] = BlazorAgGrid.util_resolveFns(v[i]);
            return v;
        }
        if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
            for (var k in v) v[k] = BlazorAgGrid.util_resolveFns(v[k]);
        }
        return v;
    },

    // Maps raw Row Node objects to something safer for passing back to .NET
    util_mapRowNode: function (n) {
        var newN = {};
        newN["id"] = n.id;
        newN["data"] = n.data;
        if (n.parent && n.parent.id !== 'ROOT_NODE_ID') {
            newN["parent"] = BlazorAgGrid.util_mapRowNode(n.parent);
        }
        newN["level"] = n.level;
        newN["uiLevel"] = n.uiLevel;
        newN["group"] = n.group;
        newN["rowPinned"] = n.rowPinned;
        newN["childIndex"] = n.childIndex;
        newN["firstChild"] = n.firstChild;
        newN["lastChild"] = n.lastChild;
        newN["stub"] = n.stub;
        newN["rowHeight"] = n.rowHeight;
        newN["rowTop"] = n.rowTop;
        newN["selectable"] = n.selectable;
        newN["selected"] = n.isSelected ? n.isSelected() : n.selected;
        newN["master"] = n.master;
        newN["expanded"] = n.expanded;
        newN["allChildrenCount"] = n.allChildrenCount;
        newN["rowIndex"] = n.rowIndex;
        return newN;
    },

    util_genId: function () {
        return Math.random().toString(36).substring(2);
    }
};
