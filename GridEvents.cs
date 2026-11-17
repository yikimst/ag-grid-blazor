using System;
using System.Text.Json;

namespace AgGrid.Blazor
{
    /// <summary>
    /// Strongly-typed counterpart of:
    ///    https://www.ag-grid.com/javascript-grid-events/
    /// </summary>
    public partial class GridEvents
    {
        /// <summary>
        /// Cell is clicked.
        /// </summary>
        public Action<CellClickedEvent> CellClicked { set => Set(value); }
        /// <summary>
        /// Row selection is changed. Use the grid API to get the new row selected.
        /// </summary>
        public Action<RowNode[]> SelectionChanged { set => Set(value); }
        /// <summary>
        /// Value has changed after editing.
        /// </summary>
        public Action<CellValueChangedEvent> CellValueChanged { set => Set(value); }
        /// <summary>
        /// A cell's value within a row has changed. This event corresponds to Full Row Editing only.
        /// </summary>
        public Action<RowValueChangedEvent> RowValueChanged { set => Set(value); }
        /// <summary>
        /// Editing a cell has started.
        /// </summary>
        public Action<CellEvent> CellEditingStarted { set => Set(value); }
        /// <summary>
        /// Editing a cell has stopped.
        /// </summary>
        public Action<CellEditingStoppedEvent> CellEditingStopped { set => Set(value); }
        /// <summary>
        /// Editing a row has started (when row editing is enabled). When row editing, this event will be fired once
        /// and cellEditingStarted will be fired for each individual cell. This event corresponds to Full Row Editing only.
        /// </summary>
        public Action<RowEvent> RowEditingStarted { set => Set(value); }
        /// <summary>
        /// Editing a row has stopped (when row editing is enabled). When row editing, this event will be fired once
        /// and cellEditingStopped will be fired for each individual cell. This event corresponds to Full Row Editing only.
        /// </summary>
        public Action<RowEvent> RowEditingStopped { set => Set(value); }

        /// <summary>
        /// Fired the first time data is rendered into the grid.
        /// </summary>
        public Action FirstDataRendered { set => Set(value); }

        /// <summary>
        /// The grid has initialised. The name 'ready' was influenced by the author's time programming the Commodore 64.
        /// Use this event if, for example, you need to use the grid's API to fix the columns to size.
        /// </summary>
        public Action GridReady { set => Set(value); }

        // ---- portal 추가 ----
        public Action<CellEvent> CellDoubleClicked { set => Set(value); }
        public Action<RowEvent> RowClicked { set => Set(value); }
        public Action<RowEvent> RowDoubleClicked { set => Set(value); }
        /// <summary>
        /// portal: 그리드 상태(getState)가 바뀌었을 때 - 그리드 상태 보관용 (Vue use-grid-cache 의 gridCacheEvents)
        ///   sortChanged / filterChanged / columnMoved·Visible·Pinned·Resized / paginationChanged(페이지·페이지 크기)
        ///   - 복원(initialState, 서버 행 모델의 페이지 이동)이 끝나기 전 변경은 제외
        ///   - flex·초기화에 따른 컬럼 너비 변경, 끌기 중간(finished=false)은 제외
        ///   - 연달아 바뀌면 300ms 뒤 한 번만
        /// </summary>
        public Action StateChanged { set => Set(value); }
    }

    /// <summary>
    /// Value has changed after editing.
    /// </summary>
    public class CellValueChangedEvent : CellEvent
    {
        public dynamic OldValue { get; set; }

        public dynamic NewValue { get; set; }
    }

    /// <summary>
    /// Value has changed after editing.
    /// </summary>
    public class CellEditingStoppedEvent : CellEvent
    {
        public dynamic OldValue { get; set; }

        public dynamic NewValue { get; set; }
    }

    /// <summary>
    /// 
    /// </summary>
    public class CellClickedEvent : CellEvent { }

    /// <summary>
    /// A cell's value within a row has changed. This event corresponds to Full Row Editing only.
    /// </summary>
    public class RowValueChangedEvent : RowEvent { }

    public class RowEvent
    {
        public JsonElement Data { get; set; }
        public string RowNodeId { get; set; }
        public int RowIndex { get; set; }
        public string RowPinned { get; set; }
        public dynamic Context { get; set; }
        public dynamic Event { get; set; }
    }

    public class CellEvent : RowEvent
    {
        ///// <summary>
        ///// the column for the cell in question
        ///// </summary>
        //public dynamic Column { get; set; }
        ///// <summary>
        ///// the column definition for the cell in question
        ///// </summary>
        //public dynamic ColDef { get; set;}

        public string Field { get; set; }

        public string ColumnId { get; set; }

        /// <summary>
        /// the value for the cell in question
        /// </summary>
        public dynamic Value { get; set; }
        /// <summary>
        /// portal: 셀 렌더러 안에서 클릭한 요소의 data-ptl-action 값 (예: "edit", "remove"). 없으면 null.
        /// </summary>
        public string Action { get; set; }
    }

    public class FirstDataRenderedEvent
    {
        public string Type { get; set; }
    }
}
