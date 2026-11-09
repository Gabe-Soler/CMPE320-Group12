#include "api_routes.h"

#include <algorithm>
#include <charconv>
#include <string>

#include "json_views.h"
#include "local_clock.h"

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

        /// GET /api/activities?minutes=45&location=goodwin-hall[&at=2026-11-13T19:00]
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

            const Query query{*minutes, from, now};
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
