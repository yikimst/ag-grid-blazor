using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.JSInterop;

namespace AgGrid.Blazor
{
    /// <summary>
    /// Strongly-typed access to:
    ///   https://www.ag-grid.com/javascript-grid-api/
    /// </summary>
    public class GridApi
    {
        internal string CallGridApi = "BlazorAgGrid.gridOptions_callGridApi";

        private IJSRuntime _js;
        private string _id;

        internal GridApi(IJSRuntime js, string id)
        {
            _js = js;
            _id = id;
        }

        public Task SizeColumnsToFit()
        {
            return CallApi("sizeColumnsToFit");
        }

        public Task RefreshCells(RefreshCellsParams @params = null)
        {
            if (@params == null)
                return CallApi("refreshCells");
            else
                return CallApi("refreshCells", @params);
        }

        public Task RedrawRows(RedrawRowsParams @params = null)
        {
            if (@params == null)
                return CallApi("redrawRows");
            else
                return CallApi("redrawRows", @params);
        }

        public Task RefreshInfiniteCache()
        {
            return CallApi("refreshInfiniteCache");
        }

        public Task PurgeInfiniteCache()
        {
            return CallApi("purgeInfiniteCache");
        }

        // https://www.ag-grid.com/javascript-grid/grid-api/

        /// <summary>
        /// Set rows
        /// </summary>
        /// <param name="rows">Data of rows</param>
        public Task SetRowData(IEnumerable<object> rows)
        {
            return CallApi("setRowData", rows);
        }

        /// <summary>
        /// portal: 바뀐 행만 반영 (AG Grid applyTransaction, 클라이언트 행 모델).
        /// 스크롤 / 선택 / 정렬 / 필터가 유지된다. remove / update 는 GridOptions.RowIdField 로 행을 찾는다.
        /// </summary>
        /// <param name="add">추가할 행</param>
        /// <param name="remove">삭제할 행 (RowIdField 값만 있으면 된다)</param>
        /// <param name="update">바꿀 행 (같은 RowIdField 의 행을 이 데이터로 교체)</param>
        /// <param name="addIndex">추가 위치 (null 이면 끝)</param>
        public Task ApplyTransaction(IEnumerable<object> add = null, IEnumerable<object> remove = null, IEnumerable<object> update = null, int? addIndex = null)
        {
            var tx = new Dictionary<string, object>();
            if (add != null) tx["add"] = add;
            if (remove != null) tx["remove"] = remove;
            if (update != null) tx["update"] = update;
            if (addIndex is >= 0) tx["addIndex"] = addIndex.Value;
            return CallApi("applyTransaction", tx);
        }

        /// <summary>
        /// Set new datasource for Infinite Row Model.
        /// </summary>
        /// <param name="datasource">New datasource</param>
        public Task SetDatasource(IGridDatasource datasource = null)
        {
            return _js.InvokeVoidAsync("BlazorAgGrid.gridOptions_setDatasource", _id, datasource).AsTask();
        }

        /// <summary>
        /// Starts editing the provided cell. If another cell is editing, the editing will be stopped in that other cell.
        /// </summary>
        /// <param name="params">Editing parameters.</param>
        public Task StartEditingCell(StartEditingCellParams @params)
        {
            if (@params == null)
            {
                throw new ArgumentNullException(nameof(@params));
            }
            return CallApi("startEditingCell", @params);
        }

        /// <summary>
        /// If a cell is editing, it stops the editing. Pass true if you want to cancel the editing (i.e. don't accept changes).
        /// </summary>
        /// <param name="cancel">Pass true if you want to cancel the editing (i.e. don't accept changes).</param>
        public Task StopEditing(bool cancel = false)
        {
            return CallApi("stopEditing", cancel);
        }

        /// <summary>
        /// Sets the focus to the specified cell.
        /// </summary>
        /// <param name="rowIndex">row index</param>
        /// <param name="colKey">col key</param>
        /// <param name="floating">'top' | 'bottom'</param>
        public Task SetFocusedCell(long rowIndex, string colKey, string? floating = null)
        {
            if (floating == null)
            {
                return CallApi("startEditingCell", rowIndex, colKey);
            }
            if (floating == "top" || floating == "bottom")
            {
                return CallApi("startEditingCell", rowIndex, colKey, floating);
            }
            throw new ArgumentException($"illegal value: \"{floating}\"", nameof(floating));
        }

        /// <summary>
        /// Select all rows, regardless of filtering and rows that are not visible due to grouping being enabled and their groups not expanded.
        /// </summary>
        public Task SelectAll()
        {
            return CallApi("selectAll");
        }

        /// <summary>
        /// Clear all row selections, regardless of filtering.
        /// </summary>
        public Task DeselectAll()
        {
            return CallApi("deselectAll");
        }

        /// <summary>
        /// Select all filtered rows.
        /// </summary>
        /// <returns></returns>
        public Task SelectAllFiltered()
        {
            return CallApi("selectAllFiltered"); 
        }

        /// <summary>
        /// Clear all filtered selections.
        /// </summary>
        public Task DeselectAllFiltered()
        {
            return CallApi("deselectAllFiltered");
        }

        // ------------------------------------------------------------------
        // portal 추가 API (AG Grid v33)
        // ------------------------------------------------------------------

        /// <summary>gridApi.setGridOption(key, value)</summary>
        public Task SetGridOption(string key, object value)
        {
            return CallApi("setGridOption", key, value);
        }

        /// <summary>행 ID(getRowId 결과 또는 내부 id)로 노드를 찾아 셀 값을 변경 (node.setDataValue)</summary>
        public Task SetDataValue(string rowNodeId, string field, object value)
        {
            return _js.InvokeVoidAsync("BlazorAgGrid.setDataValue", _id, rowNodeId, field, value).AsTask();
        }

        /// <summary>현재 그리드의 모든 행 데이터(필터/정렬 무관, 원본 순서)를 가져온다.</summary>
        public async Task<List<T>> GetRowData<T>()
        {
            return await _js.InvokeAsync<List<T>>("BlazorAgGrid.getRowData", _id);
        }

        /// <summary>선택된 행 데이터</summary>
        public async Task<List<T>> GetSelectedRows<T>()
        {
            return await _js.InvokeAsync<List<T>>("BlazorAgGrid.getSelectedRows", _id);
        }

        /// <summary>현재 페이지 크기(pagination)</summary>
        public async Task<int> GetPaginationPageSize()
        {
            return await _js.InvokeAsync<int>("BlazorAgGrid.callGridApiWithResult", _id, "paginationGetPageSize", Array.Empty<object>());
        }

        /// <summary>그리드 상태(정렬/필터/컬럼/페이지) 조회 - Vue 의 grid-cache 대응</summary>
        public async Task<System.Text.Json.JsonElement> GetState()
        {
            return await _js.InvokeAsync<System.Text.Json.JsonElement>("BlazorAgGrid.callGridApiWithResult", _id, "getState", Array.Empty<object>());
        }

        /// <summary>Excel 내보내기 (Enterprise)</summary>
        public Task ExportDataAsExcel(object @params = null)
        {
            return @params == null ? CallApi("exportDataAsExcel") : CallApi("exportDataAsExcel", @params);
        }

        /// <summary>CSV 내보내기</summary>
        public Task ExportDataAsCsv(object @params = null)
        {
            return @params == null ? CallApi("exportDataAsCsv") : CallApi("exportDataAsCsv", @params);
        }

        /// <summary>Quick filter 텍스트 설정</summary>
        public Task SetQuickFilter(string text)
        {
            return CallApi("setGridOption", "quickFilterText", text);
        }

        private Task CallApi(string name, params object[] args)
        {
            return _js.InvokeVoidAsync(CallGridApi, _id, name, args).AsTask();
        }

        public class RefreshCellsParams
        {
            /// specify rows, or all rows by default
            public RowNode[] RowNodes { get; set; }
            /// specify columns, or all columns by default
            public string[] Columns { get; set; }
            /// skips change detection, refresh everything
            public bool Force { get; set; }
        }

        public class RedrawRowsParams
        {
            /// the row nodes to redraw
            public RowNode[] RowNodes { get; set; }
        }


        /// <summary>
        /// Editing parameters.
        /// </summary>
        public class StartEditingCellParams {
            /// <summary>
            /// The row index of the row to start editing.
            /// </summary>
            public long RowIndex { get; set; }
            /// <summary>
            /// The column key of the column to start editing.
            /// </summary>
            public string ColKey { get; set; }
            /// <summary>
            ///  Set to 'top' or 'bottom' to started editing a pinned row.
            /// </summary>
            public string? RowPinned { get; set; }
            /// <summary>
            /// The keyPress that are passed to the cell editor.
            /// </summary>
            public long? KeyPress { get; set; }
            /// <summary>
            /// The charPress that are passed to the cell editor.
            /// </summary>
            public string? CharPress { get; set; }
        }
}
}
