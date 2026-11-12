using System;
using System.Collections.Generic;
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
        public GridApi Api { get; private set; }

        /// <summary>v31 부터 Column API 는 Grid API 로 통합되었다. 하위호환을 위해 유지.</summary>
        public GridColumnApi ColumnApi { get; private set; }

        protected override async Task OnParametersSetAsync()
        {
            if (_isCreated && !ReferenceEquals(_lastRowData, RowData))
            {
                _lastRowData = RowData;
                await Api.SetRowData(RowData ?? Enumerable.Empty<object>());
            }
        }

        protected override async Task OnAfterRenderAsync(bool firstRender)
        {
            if (firstRender && !_isCreated)
            {
                Api = new GridApi(JS, _id);
                ColumnApi = new GridColumnApi(JS, _id);
                await CreateGrid();
                _isCreated = true;
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
            }

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
            if (!_isCreated)
                return;
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
        }
    }
}
