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
        var ssds = op.serverSideDatasource;

        // Remember for subsequent API calls
        BlazorAgGrid.callbackMap[id] = interopOptions;

        BlazorAgGrid.normalizeOptions(op);

        if (cb) BlazorAgGrid.createGrid_wrapCallbacks(op, cb);
        if (ev) BlazorAgGrid.createGrid_wrapEvents(op, ev);
        // portal: 그리드 상태 복원(onGridReady / onFirstDataRendered) + 상태 변경 알림 (wrapEvents 뒤에 이어 붙인다)
        BlazorAgGrid.createGrid_trackState(op, (ev && ev.handlers) || {}, id);
        // portal: 서버 렌더 셀(PortalGrid.renderers.html) - 행 값이 바뀌면 그 행의 템플릿 셀을 다시 렌더
        BlazorAgGrid.createGrid_htmlCells(op);
        if (ds) BlazorAgGrid.createGrid_wrapDatasource(op, ds);
        // portal: Server-Side Row Model (Enterprise) 데이터 소스 - .NET IGridDatasource 를 그대로 사용
        if (ssds) op.serverSideDatasource = BlazorAgGrid.util_wrapServerSideDatasource(ssds);

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
        delete BlazorAgGrid._gridCacheState[id];
        for (var hk in BlazorAgGrid._headerNodes) if (hk.indexOf(id + '|') === 0) delete BlazorAgGrid._headerNodes[hk];
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
            if (k === 'rowData' || k === 'columnDefs' || k === 'defaultColDef' || k === 'datasource' || k === 'serverSideDatasource') continue;
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

        // portal: CellAction 은 셀 안의 [data-ptl-action] 요소를 눌렀을 때만 서버를 부른다 (CellClicked 는 모든 셀 클릭)
        if (h.CellClicked || h.CellAction) {
            gridOptions.onCellClicked = function (event) {
                var ev = BlazorAgGrid._cellEvent(event);
                if (h.CellClicked) invoke("CellClicked", ev);
                if (h.CellAction && ev.action) invoke("CellAction", ev);
            };
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

    // portal: 그리드 상태 복원/변경 추적 (Vue composables/use-grid-cache.ts)
    //  op.portalGridCache = { columnState, filter, page, pageSize } (.NET GusGridCache.Apply 가 넣는다)
    //  1) onGridReady        : 컬럼(순서/너비/숨김/고정)·정렬·필터·페이지 크기 복원 + 목표 페이지 확보 (savedTargetPage)
    //                          적용 직후 복원 중 표시 해제 (restoringGrid = false)
    //                          서버 행 모델도 첫 조회 전에 적용되어 첫 조회부터 정렬/필터가 들어간다
    //  2) onFirstDataRendered: 목표 페이지로 이동 (전체 페이지 수를 넘으면 마지막 페이지), 이동 후 isPageRestored
    //  3) StateChanged 핸들러가 있으면 정렬/필터/컬럼/페이지가 바뀔 때 알린다 (Vue saveGridCache)
    //     - 복원 중(restoringGrid)에는 알리지 않음
    //     - paginationChanged: 페이지 복원 전, 표시 행 0건, 페이지 번호·크기가 그대로면 알리지 않음
    //     - 페이지 복원 전에 보관하면 page 는 목표 페이지로 (gridCache_get)
    //     - flex/초기화에 따른 컬럼 너비 변경, 끌기 중간(finished=false) 제외, 연달아 바뀌면 300ms 뒤 한 번
    _gridCacheState: {},

    createGrid_trackState: function (op, h, id) {
        var cache = op.portalGridCache || null;
        delete op.portalGridCache;   // AG Grid 옵션이 아니므로 넘기지 않는다
        var track = !!h.StateChanged;
        if (!cache && !track) return;

        var targetPage = (cache && typeof cache.page === 'number' && cache.page > 0) ? cache.page : 0;
        var gs = BlazorAgGrid._gridCacheState[id] = {
            restoring: true,              // Vue restoringGrid
            savedTargetPage: targetPage,  // Vue savedTargetPage
            pageRestored: targetPage === 0 // Vue isPageRestored
        };
        var timer = null, last = null;
        var chain = function (name, fn) {
            var prev = op[name];
            op[name] = function (e) { fn(e); if (prev) prev(e); };
        };

        // 1) 그리드 준비: 컬럼/정렬/필터/페이지 크기 → 복원 중 해제
        chain('onGridReady', function (e) {
            if (cache) BlazorAgGrid.gridCache_apply(e.api, cache);
            // 적용으로 생기는 이벤트(필터/정렬/페이지 크기 변경)가 지나간 뒤 해제
            setTimeout(function () {
                if (e.api.isDestroyed()) return;
                gs.restoring = false;
                clearTimeout(timer);
                last = [e.api.paginationGetCurrentPage(), e.api.paginationGetPageSize()];
            }, 0);
        });
        // 2) 첫 데이터: 목표 페이지로 이동
        chain('onFirstDataRendered', function (e) {
            if (gs.pageRestored || gs.savedTargetPage <= 0) { gs.pageRestored = true; return; }
            // 페이지 크기 적용이 먼저 끝나도록 다음 틱에 이동 (Vue nextTick)
            setTimeout(function () {
                if (e.api.isDestroyed()) return;
                var total = e.api.paginationGetTotalPages();
                var safePage = total > 0 ? Math.min(gs.savedTargetPage, total - 1) : gs.savedTargetPage;
                e.api.paginationGoToPage(safePage);
                gs.pageRestored = true;
            }, 0);
        });
        if (!track) return;

        var fire = function (api) {
            clearTimeout(timer);
            timer = setTimeout(function () {
                if (api.isDestroyed()) return;
                h.StateChanged.jsRef.invokeMethodAsync("Invoke").catch(function () { /* 화면이 닫힌 뒤 */ });
            }, 300);
        };
        var ignored = { flex: 1, gridInitializing: 1 };
        var onChange = function (e) {
            if (gs.restoring || ignored[e.source] || e.finished === false) return;
            fire(e.api);
        };
        ['onSortChanged', 'onFilterChanged', 'onColumnMoved', 'onColumnVisible', 'onColumnPinned', 'onColumnResized']
            .forEach(function (n) { chain(n, onChange); });
        chain('onPaginationChanged', function (e) {
            if (gs.restoring) return;
            if (!gs.pageRestored) return;                         // 0페이지 덮어쓰기 방지
            if (e.api.getDisplayedRowCount() === 0) return;       // 로딩 중/0건
            var cur = [e.api.paginationGetCurrentPage(), e.api.paginationGetPageSize()];
            if (last && cur[0] === last[0] && cur[1] === last[1]) return;
            last = cur;
            fire(e.api);
        });
    },

    // portal: 화면 상태가 바뀐 템플릿 컬럼(IGridColumnRefresh)의 셀을 다시 렌더 (서버 렌더 HTML 캐시를 지우고 refreshCells)
    refreshTemplateCells: function (callbackId, colIds) {
        var api = BlazorAgGrid.apiMap[callbackId];
        if (!api || api.isDestroyed() || !colIds || !colIds.length) return;
        api.forEachNode(function (n) {
            if (n.data && n.data.__html) colIds.forEach(function (c) { delete n.data.__html[c]; });
        });
        api.refreshCells({ columns: colIds, force: true });
    },

    // portal: Blazor 로 렌더한 머리글 (ColumnDefinition.HeaderComponent)
    //  Grid.razor 의 숨은 영역 [data-ag-header-host=gridId] > [data-ag-header-slot=key] > [data-ag-header=key] 에
    //  Blazor 가 렌더한 내용을 머리글이 만들어질 때 옮겨 붙이고, 머리글이 없어질 때 제자리로 되돌린다.
    //  (Blazor 는 옮긴 요소를 그대로 갱신하고, 이벤트도 문서 단위로 받으므로 @onclick 등이 동작한다)
    //  headerComponentParams: { gridId, key }
    _headerNodes: {},
    TemplateHeader: (function () {
        function TemplateHeader() { }
        var slotOf = function (gridId, key) {
            return document.querySelector('[data-ag-header-host="' + gridId + '"] > [data-ag-header-slot="' + key + '"]');
        };
        TemplateHeader.prototype.init = function (params) {
            this.params = params;
            this.gui = document.createElement('div');
            this.gui.className = 'ag-template-header';
            this.gui.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;';
            var id = params.gridId + '|' + params.key;
            var node = BlazorAgGrid._headerNodes[id];
            if (!node || !node.isConnected) {
                var slot = slotOf(params.gridId, params.key);
                node = slot ? slot.querySelector('[data-ag-header="' + params.key + '"]') : null;
                BlazorAgGrid._headerNodes[id] = node;
            }
            this.node = node;
            if (node) this.gui.appendChild(node);
        };
        TemplateHeader.prototype.getGui = function () { return this.gui; };
        TemplateHeader.prototype.refresh = function () { return true; };
        TemplateHeader.prototype.destroy = function () {
            // 같은 머리글을 다시 만들 수 있도록 내용은 숨은 영역으로 되돌린다
            var slot = slotOf(this.params.gridId, this.params.key);
            if (this.node && slot && this.node.parentNode === this.gui) slot.appendChild(this.node);
        };
        return TemplateHeader;
    })(),

    // portal: 서버 렌더 셀(C# GusTemplateColumn → PortalGrid.renderers.html)
    //  셀 HTML 은 row.__html[colId] 에 둔다. 행 값이 바뀌면(setDataValue 등) 그 HTML 을 버리고
    //  같은 행의 템플릿 셀을 다시 그리게 해 서버에서 새로 렌더한다 (다른 필드에 따라 바뀌는 셀도 맞게)
    createGrid_htmlCells: function (op) {
        var isHtml = function (c) { return !!(c && c.cellRenderer && c.cellRenderer.isPortalHtmlCell); };
        var any = function (cols) {
            return (cols || []).some(function (c) { return isHtml(c) || any(c.children); });
        };
        if (!any(op.columnDefs) && !isHtml(op.defaultColDef)) return;
        var prev = op.onCellValueChanged;
        op.onCellValueChanged = function (e) {
            if (e.data && e.data.__html) delete e.data.__html;
            var cols = (e.api.getColumns() || []).filter(function (c) { return isHtml(c.getColDef()); });
            if (cols.length && e.node) e.api.refreshCells({ rowNodes: [e.node], columns: cols, force: true });
            if (prev) prev(e);
        };
    },

    // Vue applyGridCache: 컬럼 상태(정렬 포함) → 필터 → 페이지 크기
    gridCache_apply: function (api, cache) {
        if (cache.columnState && cache.columnState.length) {
            api.applyColumnState({ state: cache.columnState, applyOrder: !!cache.applyOrder, defaultState: { sort: null } });
        }
        if (cache.filter) api.setFilterModel(cache.filter);
        if (cache.pageSize) api.setGridOption('paginationPageSize', cache.pageSize);
    },

    // Vue gridCacheInfo: 보관할 상태 (컬럼 상태는 순서/너비/flex/숨김/고정/정렬 포함)
    gridCache_get: function (callbackId) {
        var api = BlazorAgGrid.apiMap[callbackId];
        if (!api || api.isDestroyed()) return null;
        var gs = BlazorAgGrid._gridCacheState[callbackId];
        // 아직 페이지 복원 전이면 보관된 목표 페이지를 유지 (Vue saveGridCache)
        var page = (gs && !gs.pageRestored && gs.savedTargetPage > 0) ? gs.savedTargetPage : api.paginationGetCurrentPage();
        return {
            columnState: api.getColumnState(),
            filter: api.getFilterModel(),
            page: page,
            pageSize: api.paginationGetPageSize(),
            applyOrder: true
        };
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
        if (!getRowsParams) return;
        // portal: Server-Side Row Model 은 params.success({ rowData, rowCount })
        if (typeof getRowsParams.success === 'function')
            getRowsParams.success({ rowData: rowsThisBlock, rowCount: lastRow === null ? undefined : lastRow });
        else
            getRowsParams.successCallback(rowsThisBlock, lastRow);
        delete BlazorAgGrid.callbackMap[callbackId];
    },

    datasource_failCallback: function (callbackId) {
        var getRowsParams = BlazorAgGrid.callbackMap[callbackId];
        if (!getRowsParams) return;
        if (typeof getRowsParams.fail === 'function') getRowsParams.fail();
        else getRowsParams.failCallback();
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

    // portal: Server-Side Row Model 데이터 소스. 요청(request)을 Infinite 와 같은 모양으로 .NET GetRows 에 넘긴다
    util_wrapServerSideDatasource: function (ds) {
        return {
            getRows: function (params) {
                var callbackId = BlazorAgGrid.util_genId();
                BlazorAgGrid.callbackMap[callbackId] = params;
                var r = params.request || {};
                ds.invokeMethodAsync('GetRows', {
                    startRow: r.startRow,
                    endRow: r.endRow,
                    sortModel: r.sortModel,
                    filterModel: r.filterModel,
                    callbackId: callbackId
                }).catch(function () {
                    var p = BlazorAgGrid.callbackMap[callbackId];
                    if (p) { p.fail(); delete BlazorAgGrid.callbackMap[callbackId]; }
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
