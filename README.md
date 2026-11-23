# ATIP Metrics

<!-- coolcode:guide -->
Select an institution and keep Access to Information Act and Privacy Act results separate when comparing years. Use its research workspace to collect public disclosure citations and edit a request draft; a missing publisher match does not prove that no relevant records exist.
<!-- /coolcode:guide -->

Compare federal institutions' reported Access to Information Act and Privacy Act request volumes, closures, timelines, and carryovers. The two laws stay separate and each institution page displays the available years. The table is searchable, sortable, linkable, and exportable as CSV.

## Data and local preview

Source: Treasury Board of Canada Secretariat, [Access to Information and Privacy Statistics](https://open.canada.ca/data/en/dataset/236294e1-bc74-486f-ab97-422227bc8832), [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada). The importer reads English XLSX workbooks from 2021–22 onwards. Institution trends match exact cleaned source names. A rename may end one series and begin another. Rates are calculated from counts. Extensions allowed by law count toward the legislated timeline; a report with zero closed files has no computed rate.

```sh
python -m pip install openpyxl==3.1.5
python scripts/build.py
python -m http.server 8000
```

Deploy using the included Pages workflow. The build refreshes the official sources, with a checked snapshot available if the source is temporarily unavailable.

## Institution research workspace

Select a reporting institution to open the research workspace below its annual workload. Filter both publication registers by topic or reference number and by the selected April–March fiscal year or all available dates. The summaries use completion months. Briefing titles use dates received. Privacy Act workload statistics are separate from these public disclosure registers. Each result links to the official record and the corresponding CoolCode explorer. Save up to 30 citations per institution in browser storage. Edit, copy, or download one request draft before opening the federal request portal.

The workspace matches normalized official names to unambiguous publisher IDs and uses a small set of verified display-name variants. Publishers are kept separate when a name does not resolve safely. A missing match or zero published results leaves open the possibility of other records. The index distinguishes released ATI packages from briefing titles. The latter identify potentially requestable records.

Data sources under the Open Government Licence – Canada include the [Completed Access to Information Request Summaries](https://open.canada.ca/data/en/dataset/0797e893-751e-4695-8229-a5066e4fe43c) and [Briefing Note Titles and Numbers](https://open.canada.ca/data/en/dataset/ee9bd7e8-90a5-45db-9287-85c8cf3589b6). GitHub Actions rebuilds the institution shards. For local testing, run `python3 scripts/build_research.py` after building or restoring `data.json`. Use `--ati` and `--briefings` to supply official files already downloaded.
