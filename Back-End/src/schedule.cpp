#include "schedule.h"

#include <charconv>

namespace bib
{
    namespace
    {
        std::string_view trim(std::string_view s)
        {
            while (!s.empty() && (s.front() == ' ' || s.front() == '\t')) s.remove_prefix(1);
            while (!s.empty() && (s.back() == ' ' || s.back() == '\t')) s.remove_suffix(1);
            return s;
        }

        /// Parses an unsigned integer that must fill the whole string.
        std::optional<int> parse_int(std::string_view s)
        {
            int value = 0;
            const auto [ptr, ec] = std::from_chars(s.data(), s.data() + s.size(), value);
            if (ec != std::errc{} || ptr != s.data() + s.size() || s.empty()) return std::nullopt;
            return value;
        }

        bool is_leap(int year) { return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0; }

        int days_in_month(int year, int month)
        {
            static constexpr int kDays[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
            return month == 2 && is_leap(year) ? 29 : kDays[month - 1];
        }
    }

    void Schedule::set_day(int weekday, std::vector<TimeRange> ranges)
    {
        week_.at(static_cast<std::size_t>(weekday)) = std::move(ranges);
    }

    void Schedule::limit_to_dates(DateKey first, DateKey last)
    {
        first_ = first;
        last_ = last;
    }

    const std::vector<TimeRange>& Schedule::ranges_on(DateKey date, int weekday) const
    {
        static const std::vector<TimeRange> kClosed;
        if (date < first_ || date > last_) return kClosed;
        return week_.at(static_cast<std::size_t>(weekday));
    }

    bool Schedule::is_empty() const
    {
        for (const auto& day : week_)
            if (!day.empty()) return false;
        return true;
    }

    std::optional<Minute> parse_clock(std::string_view text)
    {
        text = trim(text);
        const auto colon = text.find(':');
        if (colon == std::string_view::npos) return std::nullopt;

        const auto hours = parse_int(text.substr(0, colon));
        const auto minutes = parse_int(text.substr(colon + 1));
        if (!hours || !minutes || *minutes > 59) return std::nullopt;

        const Minute total = *hours * 60 + *minutes;
        if (total > kMinutesPerDay) return std::nullopt;
        return total;
    }

    std::optional<std::vector<TimeRange>> parse_day_hours(std::string_view text)
    {
        text = trim(text);
        std::vector<TimeRange> ranges;
        if (text.empty()) return ranges;
        if (text == "anytime") return std::vector<TimeRange>{{0, kMinutesPerDay}};

        while (!text.empty())
        {
            const auto comma = text.find(',');
            const std::string_view part = text.substr(0, comma);
            text = comma == std::string_view::npos ? std::string_view{} : text.substr(comma + 1);

            const auto dash = part.find('-');
            if (dash == std::string_view::npos) return std::nullopt;
            const auto start = parse_clock(part.substr(0, dash));
            const auto end = parse_clock(part.substr(dash + 1));
            if (!start || !end || *start >= *end) return std::nullopt;
            ranges.push_back({*start, *end});
        }
        return ranges;
    }

    std::optional<DateKey> parse_date(std::string_view text)
    {
        text = trim(text);
        if (text.size() != 10 || text[4] != '-' || text[7] != '-') return std::nullopt;
        const auto year = parse_int(text.substr(0, 4));
        const auto month = parse_int(text.substr(5, 2));
        const auto day = parse_int(text.substr(8, 2));
        if (!year || !month || !day || *month < 1 || *month > 12 || *day < 1 ||
            *day > days_in_month(*year, *month))
            return std::nullopt;
        return *year * 10000 + *month * 100 + *day;
    }

    int weekday_of(DateKey date)
    {
        // Days-from-civil (Howard Hinnant), then shift so 0 = Monday.
        int y = date / 10000;
        const int m = date / 100 % 100;
        const int d = date % 100;
        y -= m <= 2;
        const int era = (y >= 0 ? y : y - 399) / 400;
        const int yoe = y - era * 400;
        const int doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
        const int doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        const long days = static_cast<long>(era) * 146097 + doe - 719468; // 0 = 1970-01-01 (Thursday)
        return static_cast<int>(((days + 3) % 7 + 7) % 7);
    }

    std::string format_clock_12h(Minute minute)
    {
        if (minute == kMinutesPerDay || minute == 0) return "midnight";
        const int h24 = minute / 60;
        const int h12 = h24 % 12 == 0 ? 12 : h24 % 12;
        const int mm = minute % 60;

        std::string out = std::to_string(h12);
        if (mm != 0) out += (mm < 10 ? ":0" : ":") + std::to_string(mm);
        out += h24 < 12 ? " AM" : " PM";
        return out;
    }
}
