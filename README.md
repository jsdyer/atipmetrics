# ATIP Metrics

Compare federal institutions' reported Access to Information Act and Privacy Act request volumes, closures, timelines, and carryovers. The two laws stay separate and each institution page displays the available years. The table is searchable, sortable, linkable, and exportable as CSV.

## Data and local preview

Source: Treasury Board of Canada Secretariat, [Access to Information and Privacy Statistics](https://open.canada.ca/data/en/dataset/236294e1-bc74-486f-ab97-422227bc8832), [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada). The importer reads English XLSX workbooks from 2021–22 onwards. Institution trends match exact cleaned source names. A rename may end one series and begin another. Rates are calculated from counts. Extensions allowed by law count toward the legislated timeline; a report with zero closed files has no computed rate.

```sh
python -m pip install openpyxl==3.1.5
python scripts/build.py
python -m http.server 8000
```

Deploy using the included Pages workflow. The build refreshes the official sources, with a checked snapshot available if the source is temporarily unavailable.
