using System.Collections.Generic;

namespace AgGrid.Blazor
{
    /// <summary>
    /// portal: 그리드가 만들어질 때 / 없어질 때 알림을 받는 컬럼 (예: .NET 참조를 가진 서버 렌더 셀 컬럼).
    /// 같은 컬럼을 여러 그리드에서 쓰거나 그리드를 다시 만들 수 있으므로 만들 때마다 Created, 없어질 때마다 Destroyed 가 불린다.
    /// </summary>
    public interface IGridColumnLifecycle
    {
        void OnGridCreating();
        void OnGridDestroyed();
    }

    /// <summary>
    /// portal: 화면 상태에 따라 셀 내용이 바뀌는 컬럼. Grid 가 다시 그려질 때마다(부모 StateHasChanged) 물어보고,
    /// true 면 그 컬럼의 셀을 다시 렌더한다 (BlazorAgGrid.refreshTemplateCells).
    /// </summary>
    public interface IGridColumnRefresh
    {
        /// <summary>마지막으로 렌더한 뒤 상태가 바뀌었으면 true (그리고 지금 상태를 기억)</summary>
        bool CheckStateChanged();
    }

    /// <summary>
    /// portal: 그리드 옵션에 붙어 그리드와 수명을 같이 하는 객체 (GridOptions.Lifecycles 에 넣는다).
    /// 예: 서버 데이터 소스가 그리드를 만들 때 .NET 참조(DotNetObjectReference)를 만들어 옵션에 넣고, 그리드가 없어질 때 해제.
    /// 같은 옵션으로 그리드를 다시 만들 수 있으므로(@if 로 숨겼다 보이기 등) 만들 때마다 Creating, 없어질 때마다 Destroyed 가 불린다.
    /// 화면에서 Dispose 를 따로 부를 필요가 없다.
    /// </summary>
    public interface IGridOptionsLifecycle
    {
        /// <summary>그리드를 만들기 직전 (옵션을 JS 로 넘기기 전)</summary>
        void OnGridCreating(GridOptions options, Microsoft.JSInterop.IJSRuntime js);
        /// <summary>그리드 컴포넌트가 없어질 때</summary>
        void OnGridDestroyed();
    }

    internal static class GridColumnLifecycle
    {
        public static void EachColumn(IEnumerable<ColumnDefinition> columns, System.Action<ColumnDefinition> action)
        {
            if (columns == null) return;
            foreach (var c in columns)
            {
                EachColumn(c.Children, action);
                action(c);
            }
        }

        public static void Each(IEnumerable<ColumnDefinition> columns, System.Action<IGridColumnLifecycle> action)
        {
            if (columns == null) return;
            foreach (var c in columns)
            {
                Each(c.Children, action);
                if (c is IGridColumnLifecycle l) action(l);
            }
        }
    }
}
