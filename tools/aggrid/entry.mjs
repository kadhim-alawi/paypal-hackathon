// AG Grid modules used by the treasurer Ledger. Bundled separately so only staff
// opening the Ledger download them. AG Grid Enterprise is commercial software:
// without a licence key it runs in evaluation mode with a watermark.
import {
  ModuleRegistry, createGrid, themeQuartz,
  ClientSideRowModelModule, ClientSideRowModelApiModule, TextFilterModule, NumberFilterModule, DateFilterModule,
  QuickFilterModule, CsvExportModule, PinnedRowModule, ColumnAutoSizeModule, TooltipModule,
  CellStyleModule, RowStyleModule, ColumnApiModule, GridStateModule, RenderApiModule,
} from "ag-grid-community";
import {
  LicenseManager, AiToolkitModule, RowGroupingModule, RowGroupingPanelModule, PivotModule, SetFilterModule,
  ExcelExportModule, ColumnsToolPanelModule, FiltersToolPanelModule, SideBarModule, StatusBarModule,
  ColumnMenuModule, ContextMenuModule, GroupFilterModule,
} from "ag-grid-enterprise";

ModuleRegistry.registerModules([
  ClientSideRowModelModule, ClientSideRowModelApiModule, TextFilterModule, NumberFilterModule, DateFilterModule,
  QuickFilterModule, CsvExportModule, PinnedRowModule, ColumnAutoSizeModule, TooltipModule, CellStyleModule,
  RowStyleModule, ColumnApiModule, GridStateModule, RenderApiModule,
  AiToolkitModule, RowGroupingModule, RowGroupingPanelModule, PivotModule, SetFilterModule, ExcelExportModule,
  ColumnsToolPanelModule, FiltersToolPanelModule, SideBarModule, StatusBarModule, ColumnMenuModule,
  ContextMenuModule, GroupFilterModule,
]);

window.agGrid = { createGrid, themeQuartz, LicenseManager };
