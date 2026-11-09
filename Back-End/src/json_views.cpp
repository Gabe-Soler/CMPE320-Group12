#include "json_views.h"

#include <string>

namespace bib
{
    namespace
    {
        std::string clock_24h(Minute minute)
        {
            const int h = minute / 60, m = minute % 60;
            return (h < 10 ? "0" : "") + std::to_string(h) + (m < 10 ? ":0" : ":") + std::to_string(m);
        }

        /// Short status line for the card: "Starts at 7:30 PM", "Open until 5 PM", "Anytime".
        std::string availability(const Suggestion& s)
        {
            // A fixed-time event (it fills its whole slot) is described by its start, even if it starts now.
            const bool fixedEvent = s.window.end - s.window.start == s.activity->duration;
            if (s.wait > 0 || fixedEvent) return "Starts at " + format_clock_12h(s.startsAt);
            if (s.window.is_all_day()) return "Anytime";
            return "Open until " + format_clock_12h(s.window.end);
        }

        /// The "Why it fits" sentence on the detail page.
        std::string reason(const Suggestion& s)
        {
            std::string out = "About " + std::to_string(s.total) + " min in all: ";
            if (s.walk > 0) out += std::to_string(s.walk) + " min walk each way, ";
            if (s.wait > 0) out += std::to_string(s.wait) + " min until it starts, ";
            out += std::to_string(s.activity->duration) + " min there.";

            const int spare = s.budget - s.total;
            if (spare > 0) out += " That leaves you " + std::to_string(spare) + " min to spare.";
            return out;
        }

        crow::json::wvalue suggestion_json(const Suggestion& s)
        {
            const Activity& a = *s.activity;
            crow::json::wvalue j;
            j["id"] = a.id;
            j["name"] = a.name;
            j["category"] = a.category;
            j["description"] = a.description;
            j["place"] = a.place;
            j["lat"] = a.where.lat;
            j["lng"] = a.where.lng;
            j["duration"] = a.duration;
            j["walk"] = s.walk;
            j["wait"] = s.wait;
            j["startsAt"] = clock_24h(s.startsAt);
            j["total"] = s.total;
            j["cost"] = std::string(to_string(a.cost));
            j["availability"] = availability(s);
            j["reason"] = reason(s);
            return j;
        }
    }

    crow::json::wvalue locations_json(const std::vector<Location>& locations)
    {
        crow::json::wvalue::list list;
        list.reserve(locations.size());
        for (const Location& loc : locations)
        {
            crow::json::wvalue j;
            j["id"] = loc.id;
            j["name"] = loc.name;
            list.push_back(std::move(j));
        }
        crow::json::wvalue body;
        body["locations"] = std::move(list);
        return body;
    }

    crow::json::wvalue activities_json(const Query& query, const std::vector<Suggestion>& suggestions)
    {
        crow::json::wvalue::list list;
        list.reserve(suggestions.size());
        for (const Suggestion& s : suggestions) list.push_back(suggestion_json(s));

        crow::json::wvalue body;
        body["query"]["minutes"] = query.minutes;
        body["query"]["location"] = query.from->id;
        body["query"]["time"] = clock_24h(query.now.minute);
        body["activities"] = std::move(list);
        return body;
    }
}
