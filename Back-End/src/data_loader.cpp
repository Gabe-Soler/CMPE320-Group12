#include "data_loader.h"

#include <array>
#include <charconv>
#include <fstream>
#include <stdexcept>

#include "csv.h"

namespace bib
{
    namespace
    {
        /// Thrown inside a row parser; turned into a warning for that row.
        struct RowError : std::runtime_error
        {
            using std::runtime_error::runtime_error;
        };

        std::size_t require(const CsvHeader& header, std::initializer_list<std::string_view> names)
        {
            if (const auto index = header.find(names)) return *index;
            throw std::runtime_error("missing column \"" + std::string(*names.begin()) + "\"");
        }

        double to_double(std::string_view text, const char* what)
        {
            // std::from_chars for double is missing on some standard libraries (Apple clang), so use stod.
            try
            {
                std::size_t used = 0;
                const double value = std::stod(std::string(text), &used);
                if (used == text.size()) return value;
            }
            catch (const std::exception&)
            {
            }
            throw RowError(std::string("bad ") + what + " \"" + std::string(text) + "\"");
        }

        int to_int(std::string_view text, const char* what)
        {
            int value = 0;
            const auto [ptr, ec] = std::from_chars(text.data(), text.data() + text.size(), value);
            if (ec != std::errc{} || ptr != text.data() + text.size() || text.empty())
                throw RowError(std::string("bad ") + what + " \"" + std::string(text) + "\"");
            return value;
        }

        std::ifstream open(const std::filesystem::path& file)
        {
            std::ifstream in(file, std::ios::binary);
            if (!in) throw std::runtime_error("cannot open " + file.string());
            return in;
        }

        /// Shared loop: header lookup is done once by makeParser, then each row is parsed
        /// with the returned callable. Row numbers in warnings match the spreadsheet (header = 1).
        template <typename T, typename MakeParser>
        LoadResult<T> parse_rows(std::istream& in, MakeParser makeParser)
        {
            const auto rows = parse_csv(in);
            if (rows.empty()) throw std::runtime_error("file is empty");

            const auto parseRow = makeParser(CsvHeader(rows.front()));
            LoadResult<T> result;
            result.items.reserve(rows.size() - 1);
            for (std::size_t i = 1; i < rows.size(); ++i)
            {
                try
                {
                    result.items.push_back(parseRow(rows[i], static_cast<int>(result.items.size())));
                }
                catch (const RowError& e)
                {
                    result.warnings.push_back("row " + std::to_string(i + 1) + ": " + e.what());
                }
            }
            return result;
        }

        Schedule parse_schedule(const CsvRow& row, const std::array<std::size_t, 7>& dayColumns,
                                std::size_t dateColumn)
        {
            Schedule schedule;
            for (int day = 0; day < 7; ++day)
            {
                const auto text = field(row, dayColumns[static_cast<std::size_t>(day)]);
                auto ranges = parse_day_hours(text);
                if (!ranges) throw RowError("bad hours \"" + std::string(text) + "\"");
                schedule.set_day(day, std::move(*ranges));
            }
            if (schedule.is_empty()) throw RowError("no opening hours on any day");

            // "" = every week, "YYYY-MM-DD" = that day only, "YYYY-MM-DD/YYYY-MM-DD" = inclusive span.
            const auto dates = field(row, dateColumn);
            if (!dates.empty())
            {
                const auto slash = dates.find('/');
                const auto first = parse_date(dates.substr(0, slash));
                const auto last = slash == std::string_view::npos ? first : parse_date(dates.substr(slash + 1));
                if (!first || !last || *first > *last) throw RowError("bad date \"" + std::string(dates) + "\"");
                schedule.limit_to_dates(*first, *last);
            }
            return schedule;
        }
    }

    LoadResult<Activity> parse_activities(std::istream& in)
    {
        return parse_rows<Activity>(in, [](const CsvHeader& h) {
            const std::size_t name = require(h, {"name"}), category = require(h, {"category"}),
                              description = require(h, {"description"}), place = require(h, {"place"}),
                              lat = require(h, {"lat"}), lng = require(h, {"lng", "lon"}),
                              duration = require(h, {"duration"}), cost = require(h, {"cost"}),
                              date = require(h, {"date"});
            const std::array<std::size_t, 7> days = {
              require(h, {"mon"}), require(h, {"tue"}), require(h, {"wed"}), require(h, {"thurs", "thu"}),
              require(h, {"fri"}), require(h, {"sat"}),  require(h, {"sun"})};

            return [=](const CsvRow& row, int id) {
                Activity a{id,
                           std::string(field(row, name)),
                           std::string(field(row, category)),
                           std::string(field(row, description)),
                           std::string(field(row, place)),
                           {to_double(field(row, lat), "lat"), to_double(field(row, lng), "lng")},
                           to_int(field(row, duration), "duration"),
                           parse_cost(field(row, cost)),
                           parse_schedule(row, days, date)};
                if (a.name.empty()) throw RowError("missing name");
                if (a.duration <= 0) throw RowError("duration must be positive");
                return a;
            };
        });
    }

    LoadResult<Location> parse_locations(std::istream& in)
    {
        return parse_rows<Location>(in, [](const CsvHeader& h) {
            const std::size_t id = require(h, {"id"}), name = require(h, {"name"}), lat = require(h, {"lat"}),
                              lng = require(h, {"lng", "lon"});

            return [=](const CsvRow& row, int) {
                Location loc{std::string(field(row, id)), std::string(field(row, name)), std::nullopt};
                if (loc.id.empty() || loc.name.empty()) throw RowError("missing id or name");
                if (!field(row, lat).empty() || !field(row, lng).empty())
                    loc.point = GeoPoint{to_double(field(row, lat), "lat"), to_double(field(row, lng), "lng")};
                return loc;
            };
        });
    }

    LoadResult<Activity> load_activities(const std::filesystem::path& file)
    {
        auto in = open(file);
        return parse_activities(in);
    }

    LoadResult<Location> load_locations(const std::filesystem::path& file)
    {
        auto in = open(file);
        return parse_locations(in);
    }
}
