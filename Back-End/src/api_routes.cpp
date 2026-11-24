#include "api_routes.h"

#include <algorithm>
#include <charconv>
#include <string>

#include "json_views.h"
#include "local_clock.h"
#include "schedule.h"

namespace bib
{
    namespace
    {
        constexpr int kMinMinutes = 5;
        constexpr int kMaxMinutes = 24 * 60;

        crow::response error(int status, const std::string& message)
        {
            crow::json::wvalue body;
            body["error"] = message;
            return crow::response(status, body);
        }

        std::optional<int> parse_minutes(const char* text)
        {
            if (text == nullptr) return std::nullopt;
            const std::string_view s(text);
            int value = 0;
            const auto [ptr, ec] = std::from_chars(s.data(), s.data() + s.size(), value);
            if (ec != std::errc{} || ptr != s.data() + s.size() || value < kMinMinutes || value > kMaxMinutes)
                return std::nullopt;
            return value;
        }

        const Location* find_location(const std::vector<Location>& locations, const char* id)
        {
            if (id == nullptr) return nullptr;
            const auto it = std::find_if(locations.begin(), locations.end(),
                                         [&](const Location& l) { return l.id == id; });
            return it == locations.end() ? nullptr : &*it;
        }

        std::optional<int> parse_buffer(const char* text)
        {
            if (text == nullptr || *text == '\0') return 0;
            int value = 0;
            const std::string_view s(text);
            const auto [ptr, ec] = std::from_chars(s.data(), s.data() + s.size(), value);
            if (ec != std::errc{} || ptr != s.data() + s.size() || value < 0 || value > 60)
                return std::nullopt;
            return value;
        }

        std::optional<Minute> parse_until(const char* text, const LocalTime& now)
        {
            if (text == nullptr || *text == '\0') return std::nullopt;
            const std::string_view s(text);
            if (s.size() == 16 && s[10] == 'T')
            {
                const auto parsed = parse_local_datetime(s);
                if (!parsed || parsed->date != now.date) return Minute{-1}; // signal invalid
                return parsed->minute;
            }
            const auto clock = parse_clock(s);
            if (!clock) return Minute{-1};
            return *clock;
        }

        /// GET /api/activities?minutes=45&location=goodwin-hall[&at=...][&destination=][&until=][&buffer=]
        crow::response handle_activities(const AppData& data, const crow::request& req)
        {
            const auto minutes = parse_minutes(req.url_params.get("minutes"));
            if (!minutes)
                return error(crow::status::BAD_REQUEST, "minutes must be a whole number from 5 to 1440");

            const Location* from = find_location(data.locations, req.url_params.get("location"));
            if (from == nullptr) return error(crow::status::BAD_REQUEST, "unknown location; see /api/locations");

            LocalTime now = now_in_kingston();
            if (const char* at = req.url_params.get("at"))
            {
                const auto parsed = parse_local_datetime(at);
                if (!parsed) return error(crow::status::BAD_REQUEST, "at must look like 2026-11-13T19:00");
                now = *parsed;
            }

            Query query{*minutes, from, now};

            if (const char* dest = req.url_params.get("destination"))
            {
                query.to = find_location(data.locations, dest);
                if (query.to == nullptr)
                    return error(crow::status::BAD_REQUEST, "unknown destination; see /api/locations");
                if (!query.to->point)
                    return error(crow::status::BAD_REQUEST,
                                 "destination must be a mapped campus landmark, not Anywhere");
            }

            const auto buffer = parse_buffer(req.url_params.get("buffer"));
            if (!buffer) return error(crow::status::BAD_REQUEST, "buffer must be a whole number from 0 to 60");
            query.arrivalBuffer = *buffer;

            if (req.url_params.get("until"))
            {
                const auto until = parse_until(req.url_params.get("until"), now);
                if (!until || *until < 0)
                    return error(crow::status::BAD_REQUEST,
                                 "until must be HH:MM or YYYY-MM-DDTHH:MM on the same day as the search");
                if (*until <= now.minute)
                    return error(crow::status::BAD_REQUEST, "until must be later the same day than the start time");
                query.until = *until;
            }

            return crow::response(activities_json(query, data.recommender.recommend(query)));
        }
    }

    void register_api_routes(crow::SimpleApp& app, const AppData& data)
    {
        CROW_ROUTE(app, "/api/health")
        ([&data] {
            crow::json::wvalue body;
            body["status"] = "ok";
            body["activities"] = data.recommender.activities().size();
            body["locations"] = data.locations.size();
            return body;
        });

        CROW_ROUTE(app, "/api/locations")
        ([&data] { return locations_json(data.locations); });

        CROW_ROUTE(app, "/api/activities")
        ([&data](const crow::request& req) { return handle_activities(data, req); });
    }
}
