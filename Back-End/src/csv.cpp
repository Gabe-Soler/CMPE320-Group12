#include "csv.h"

#include <algorithm>
#include <cctype>
#include <iterator>

namespace bib
{
    namespace
    {
        std::string to_lower(std::string_view s)
        {
            std::string out(s);
            std::transform(out.begin(), out.end(), out.begin(),
                           [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
            return out;
        }

        bool is_blank(const CsvRow& row) { return row.size() == 1 && row.front().empty(); }
    }

    std::vector<CsvRow> parse_csv(std::istream& in)
    {
        const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
        std::size_t pos = 0;
        if (text.compare(0, 3, "\xEF\xBB\xBF") == 0) pos = 3; // skip a UTF-8 BOM from Excel exports

        std::vector<CsvRow> rows;
        CsvRow row;
        std::string fieldText;
        bool inQuotes = false;

        const auto endRow = [&] {
            row.push_back(std::move(fieldText));
            fieldText.clear();
            if (!is_blank(row)) rows.push_back(std::move(row));
            row.clear();
        };

        for (; pos < text.size(); ++pos)
        {
            const char c = text[pos];
            if (inQuotes)
            {
                if (c != '"') fieldText += c;
                else if (pos + 1 < text.size() && text[pos + 1] == '"') fieldText += '"', ++pos;
                else inQuotes = false;
            }
            else if (c == '"') inQuotes = true;
            else if (c == ',') row.push_back(std::move(fieldText)), fieldText.clear();
            else if (c == '\n') endRow();
            else if (c != '\r') fieldText += c;
        }
        if (!fieldText.empty() || !row.empty()) endRow();
        return rows;
    }

    CsvHeader::CsvHeader(const CsvRow& header)
    {
        lowered_.reserve(header.size());
        for (const auto& name : header) lowered_.push_back(to_lower(name));
    }

    std::optional<std::size_t> CsvHeader::find(std::initializer_list<std::string_view> names) const
    {
        for (const auto name : names)
        {
            const auto it = std::find(lowered_.begin(), lowered_.end(), to_lower(name));
            if (it != lowered_.end()) return static_cast<std::size_t>(it - lowered_.begin());
        }
        return std::nullopt;
    }

    std::string_view field(const CsvRow& row, std::size_t index)
    {
        return index < row.size() ? std::string_view(row[index]) : std::string_view{};
    }
}
