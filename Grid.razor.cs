using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Text.Json;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;

namespace AgGrid.Blazor
{
    /// <summary>
    /// AG Grid (v33) Blazor wrapper.
    /// 그리드 생성은 첫 렌더 이후 JS interop(BlazorAgGrid.createGrid) 으로 수행된다.
    /// </summary>
    public partial class Grid : ComponentBase, IAsyncDisposable
    {
#pragma warning disable CS0649
        // These are referenced by nested components as cascading parameters
        private List<ColumnDefinition> _columnDefinitions = new List<ColumnDefinition>();
        private List<object> _rowData = new List<object>();
        // This will be populated by the component @ref
        private ElementReference _gridDiv;
#pragma warning restore CS0649

        // A unique ID is assigned to the Grid for Grid API references
        private readonly string _id = "aggrid-" + Guid.NewGuid().ToString("N");
        private bool _isCreated;
        private object _lastRowData;
        private List<ColumnDefinition> _createdColumns;
        private List<IGridOptionsLifecycle> _createdLifecycles;
        // portal: 머리글 템플릿 컬럼 (키 = colId / field / 순번)
        private List<(string Key, ColumnDefinition Column)> _headerTemplates = new();

        [Parameter] public RenderFragment ChildContent { get; set; }
        [Parameter] public string HeightStyle { get; set; } = "500px";
        [Parameter] public string WidthStyle { get; set; } = "100%";
        [Parameter] public string Style { get; set; }
        [Parameter] public GridOptions Options { get; set; }
        [Parameter] public GridEvents Events { get; set; }
        [Parameter] public GridCallbacks Callbacks { get; set; }

        /// <summary>
        /// 그리드 생성 직전에 호출할 전역 JS 함수 이름 (window[ConfigureScript](gridOptions)).
        /// .NET 에서 표현하기 어려운 옵션(함수 등)을 JS 에서 직접 설정할 때 사용.
        /// </summary>
        [Parameter] public string ConfigureScript { get; set; }

        /// <summary>
        /// 추가 CSS 클래스. AG Grid v33 Theming API 를 사용하므로 기본값은 빈 값이다.
        /// (레거시 CSS 테마를 쓰려면 Options.AdditionalOptions["theme"]="legacy" 와 함께 "ag-theme-alpine" 등을 지정)
        /// </summary>
        [Parameter] public string Class { get; set; } = "";

        /// <summary>
        /// 클라이언트 행 데이터. 값(참조)이 바뀌면 그리드에 자동 반영된다.
        /// (Vue 의 :row-data 바인딩 대응)
        /// </summary>
        [Parameter] public IEnumerable<object> RowData { get; set; }

        /// <summary>그리드 생성 완료(onGridReady) 후 호출.</summary>
        [Parameter] public EventCallback<Grid> OnGridReady { get; set; }

        [Inject] private IJSRuntime JS { get; set; }

        public string Id => _id;

        /// <summary>
        /// portal: 그리드 컴포넌트가 없어질 때 (화면 이동, @if 로 사라짐 등).
        /// 그리드 참조를 받은 쪽(예: GusGridCache)이 등록한 핸들러를 스스로 정리할 수 있게 한다.
        /// </summary>
        public event Action<Grid> Disposed;
        public GridApi Api { get; private set; }

        /// <summary>v31 부터 Column API 는 Grid API 로 통합되었다. 하위호환을 위해 유지.</summary>
        public GridColumnApi ColumnApi { get; private set; }

        protected override void OnParametersSet()
        {
            // portal: 머리글 템플릿 (Blazor 로 렌더해 AG Grid 머리글로 옮긴다)
            _headerTemplates = new();
            var i = 0;
            CollectHeaderTemplates(Options?.ColumnDefinitions, ref i);
        }

        private void CollectHeaderTemplates(IEnumerable<ColumnDefinition> columns, ref int i)
        {
            if (columns == null) return;
            foreach (var c in columns)
            {
                CollectHeaderTemplates(c.Children, ref i);
                if (c.HeaderComponent != null)
                    _headerTemplates.Add(("h" + (i++) + "_" + (c.ColId ?? c.Field ?? ""), c));
            }
        }

        protected override async Task OnParametersSetAsync()
        {
            if (_isCreated && !ReferenceEquals(_lastRowData, RowData))
            {
                _lastRowData = RowData;
                ObserveRowData(RowData);
                await Api.SetRowData(RowData ?? Enumerable.Empty<object>());
            }
        }

        // ------------------------------------------------------------------ portal: ObservableCollection 행 (Vue ref 처럼)
        //   RowData 가 INotifyCollectionChanged(ObservableCollection 등)면 목록 변경을 그리드에 바로 반영한다.
        //     _rows.Add(row) / _rows.Remove(row) / _rows[i] = row  → applyTransaction (바뀐 행만, 스크롤/선택/정렬/필터 유지)
        //     Clear / Move / 그 밖의 변경                          → 전체 다시 넣기 (setRowData)
        //   삭제 / 교체는 RowIdField 로 행을 찾는다. RowIdField 가 없으면 전체 다시 넣기.
        //   항목 안의 속성만 바꾼 것은 알 수 없으므로 _rows[i] = row 처럼 그 항목을 다시 넣는다.

        private INotifyCollectionChanged _observed;

        private void ObserveRowData(IEnumerable<object> rows)
        {
            var next = rows as INotifyCollectionChanged;
            if (ReferenceEquals(_observed, next)) return;
            if (_observed != null) _observed.CollectionChanged -= OnRowDataChanged;
            _observed = next;
            if (_observed != null) _observed.CollectionChanged += OnRowDataChanged;
        }

        private void OnRowDataChanged(object sender, NotifyCollectionChangedEventArgs e)
        {
            if (!_isCreated || !ReferenceEquals(sender, _observed)) return;
            // 변경 내용을 지금 복사해 둔다 (이벤트 뒤에 목록이 또 바뀔 수 있음)
            var newItems = e.NewItems?.Cast<object>().ToList();
            var oldItems = e.OldItems?.Cast<object>().ToList();
            var snapshot = ((IEnumerable)sender).Cast<object>().ToList();
            _ = InvokeAsync(() => ApplyRowDataChangeAsync(e.Action, newItems, oldItems, e.NewStartingIndex, snapshot));
        }

        private async Task ApplyRowDataChangeAsync(NotifyCollectionChangedAction action, List<object> newItems, List<object> oldItems, int newIndex, List<object> snapshot)
        {
            try
            {
                var idField = Options?.RowIdField;
                switch (action)
                {
                    case NotifyCollectionChangedAction.Add when newItems != null:
                        await Api.ApplyTransaction(add: newItems, addIndex: newIndex);
                        return;
                    case NotifyCollectionChangedAction.Remove when oldItems != null && !string.IsNullOrEmpty(idField):
                        await Api.ApplyTransaction(remove: oldItems);
                        return;
                    case NotifyCollectionChangedAction.Replace when newItems != null && oldItems != null && !string.IsNullOrEmpty(idField):
                    {
                        // 같은 ID 면 update (선택 유지), 다른 ID 면 remove + add
                        var oldIds = new HashSet<string>(oldItems.Select(o => RowIdOf(o, idField)));
                        var newIds = new HashSet<string>(newItems.Select(o => RowIdOf(o, idField)));
                        var update = newItems.Where(o => oldIds.Contains(RowIdOf(o, idField))).ToList();
                        var add = newItems.Where(o => !oldIds.Contains(RowIdOf(o, idField))).ToList();
                        var remove = oldItems.Where(o => !newIds.Contains(RowIdOf(o, idField))).ToList();
                        await Api.ApplyTransaction(add: add.Count > 0 ? add : null, remove: remove.Count > 0 ? remove : null,
                            update: update.Count > 0 ? update : null, addIndex: add.Count > 0 ? newIndex : null);
                        return;
                    }
                    default:
                        await Api.SetRowData(snapshot);
                        return;
                }
            }
            catch (JSDisconnectedException) { }
            catch (ObjectDisposedException) { }
            catch (Exception ex)
            {
                Console.WriteLine("WARNING: AgGrid row data change failed: " + ex.Message);
            }
        }

        // JS 로 보낼 때와 같은 직렬화(JSON camelCase)로 행 ID 필드 값
        private static string RowIdOf(object row, string idField)
        {
            if (row == null) return "";
            var el = JsonSerializer.SerializeToElement(row, row.GetType(), JsonSerializerOptions.Web);
            if (el.ValueKind != JsonValueKind.Object) return "";
            foreach (var p in el.EnumerateObject())
                if (p.NameEquals(idField))
                    return p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() : p.Value.GetRawText();
            return "";
        }

        protected override async Task OnAfterRenderAsync(bool firstRender)
        {
            // portal: 화면 상태에 따라 바뀌는 셀(IGridColumnRefresh)은 상태가 바뀌었으면 다시 렌더
            if (!firstRender && _isCreated && _createdColumns != null)
            {
                var changed = new List<string>();
                GridColumnLifecycle.EachColumn(_createdColumns, c =>
                {
                    if (c is IGridColumnRefresh r && r.CheckStateChanged())
                        changed.Add(c.ColId ?? c.Field);
                });
                if (changed.Count > 0)
                {
                    try { await JS.InvokeVoidAsync("BlazorAgGrid.refreshTemplateCells", _id, changed); }
                    catch (JSDisconnectedException) { }
                }
            }

            if (firstRender && !_isCreated)
            {
                Api = new GridApi(JS, _id);
                ColumnApi = new GridColumnApi(JS, _id);
                await CreateGrid();
                _isCreated = true;
                // portal: 그리드를 만드는 동안(JS 호출을 기다리는 사이) RowData 가 바뀌었으면 지금 넣는다.
                //   (그 사이의 OnParametersSetAsync 는 _isCreated 가 false 라 건너뛰므로, 비동기로 받은 행이 빠지고 Loading 만 남던 문제)
                if (!ReferenceEquals(_lastRowData, RowData))
                {
                    _lastRowData = RowData;
                    ObserveRowData(RowData);
                    await Api.SetRowData(RowData ?? Enumerable.Empty<object>());
                }
                if (OnGridReady.HasDelegate)
                    await OnGridReady.InvokeAsync(this);
            }
        }

        private async Task CreateGrid()
        {
            Options ??= new GridOptions();

            if (_columnDefinitions?.Count > 0)
                Options.InternalColumnDefinitions = _columnDefinitions;

            if (_rowData?.Count > 0)
                Options.InternalRowData = _rowData;

            if (RowData != null)
            {
                Options.RowData = RowData;
                _lastRowData = RowData;
                ObserveRowData(RowData);
            }

            // portal: 머리글 템플릿 → BlazorAgGrid.TemplateHeader (숨은 영역에서 렌더한 Blazor 내용을 옮겨 붙인다)
            foreach (var h in _headerTemplates)
            {
                h.Column.HeaderComponentName = "fn:BlazorAgGrid.TemplateHeader";
                h.Column.HeaderComponentParams = new { gridId = _id, key = h.Key };
            }

            // portal: 컬럼에 그리드 생성 알림 (서버 렌더 셀의 .NET 참조 만들기 등)
            _createdColumns = Options.ColumnDefinitions?.ToList();
            GridColumnLifecycle.Each(_createdColumns, c => c.OnGridCreating());
            // portal: 옵션에 붙은 객체에 그리드 생성 알림 (서버 데이터 소스의 .NET 참조 만들기 등)
            _createdLifecycles = Options.Lifecycles.ToList();
            foreach (var l in _createdLifecycles) l.OnGridCreating(Options, JS);

            // Execute any needed adjustments or tranformations
            // before handing off the options for JS interop
            Options.FirePrepareForInterop(JS);

            // ag-Grid 는 null 과 undefined 를 다르게 취급하므로 null 값은 직렬화에서 제외한다.
            var interopOptions = new InteropGridOptions
            {
                CallbackId = _id,
                Options = Options,
                Callbacks = Callbacks,
                Events = Events,
            };

            await JS.InvokeVoidAsync("BlazorAgGrid.createGrid", _gridDiv, interopOptions, ConfigureScript);
        }

        public async ValueTask DisposeAsync()
        {
            // portal: 그리드 참조를 가진 쪽에 알림 (먼저 알려 핸들러 정리)
            var disposed = Disposed;
            Disposed = null;
            ObserveRowData(null);   // portal: ObservableCollection 구독 해제
            try { disposed?.Invoke(this); }
            catch (Exception ex) { Console.WriteLine("WARNING: AgGrid Disposed handler failure: " + ex.Message); }

            if (!_isCreated)
                return;
            // portal: 컬럼이 가진 .NET 참조(서버 렌더 셀 등) 정리
            GridColumnLifecycle.Each(_createdColumns, c => c.OnGridDestroyed());
            _createdColumns = null;
            try
            {
                await JS.InvokeVoidAsync("BlazorAgGrid.destroyGrid", _id);
            }
            catch (JSDisconnectedException)
            {
                // circuit 종료 시 무시
            }
            catch (Exception ex)
            {
                Console.WriteLine("WARNING: AgGrid clean up failure: " + ex.Message);
            }
            // portal: 옵션에 붙은 객체 정리 (JS 그리드가 없어진 뒤: AG Grid 가 destroy 때 데이터 소스 Destroy 를 부르므로)
            if (_createdLifecycles != null)
                foreach (var l in _createdLifecycles) l.OnGridDestroyed();
            _createdLifecycles = null;
        }

    }
}
