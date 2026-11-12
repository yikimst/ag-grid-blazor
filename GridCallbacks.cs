using System;
using System.Text.Json;

namespace AgGrid.Blazor
{
    /// <summary>
    /// Strongly-typed counterpart of:
    ///    https://www.ag-grid.com/javascript-grid-callbacks/
    /// </summary>
    public partial class GridCallbacks
    {
        [Obsolete("Blazor Server 에서는 동기 JS->.NET 호출이 불가하여 동작하지 않습니다. GridOptions.RowIdField 를 사용하세요.")]
        public Func<JsonElement, string> GetRowNodeId { set => Set(value); }

        [Obsolete("Blazor Server 에서는 동기 JS->.NET 호출이 불가하여 동작하지 않습니다. GridOptions.DataPathField 를 사용하세요.")]
        public Func<JsonElement, string[]> GetDataPath { set => Set(value); }
    }
}
