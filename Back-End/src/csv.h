#pragma once

#include <istream>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace bib
{
    using CsvRow = std::vector<std::string>;

    /// Reads RFC 4180 CSV: quoted fields, "" escapes, commas and newlines
    /// inside quotes, LF or CRLF line endings. Blank lines are skipped.
    std::vector<CsvRow> parse_csv(std::istream& in);

    /// Looks up columns by header name, so column order in the file does not matter.
    class CsvHeader
    {
      public:
        explicit CsvHeader(const CsvRow& header);

        /// Index of the first header matching any of the names (case-insensitive).
        std::optional<std::size_t> find(std::initializer_list<std::string_view> names) const;

      private:
        std::vector<std::string> lowered_;
    };

    /// The field at index, or "" when the row is shorter than the header.
    std::string_view field(const CsvRow& row, std::size_t index);
}
