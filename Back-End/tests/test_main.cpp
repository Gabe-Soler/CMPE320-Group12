// Unit tests for the data and recommendation modules. Run with `make test`.
// A tiny self-contained harness: no test framework to download.

#include <iostream>
#include <sstream>
#include <string>

#include "csv.h"
#include "data_loader.h"
#include "geo.h"
#include "local_clock.h"
#include "recommender.h"
#include "schedule.h"

namespace
{
    int failures = 0;
    int checks = 0;

#define CHECK(cond)                                                                       \
    do                                                                                    \
    {                                                                                     \
        ++checks;                                                                         \
        if (!(cond))                                                                      \
        {                                                                                 \
            ++failures;                                                                   \
            std::cerr << __FILE__ << ":" << __LINE__ << ": CHECK failed: " #cond "\n";    \
        }                                                                                 \
    } while (0)

    using namespace bib;

    void test_csv()
    {
        std::istringstream in("a,b,c\n\"x, y\",\"say \"\"hi\"\"\",\r\n\nlast,,z");
        const auto rows = parse_csv(in);
        CHECK(rows.size() == 3);
        CHECK(rows[1][0] == "x, y");
        CHECK(rows[1][1] == "say \"hi\"");
        CHECK(rows[1][2].empty());
        CHECK(rows[2][2] == "z");

        const CsvHeader header(rows[0]);
        CHECK(header.find({"B"}) == std::optional<std::size_t>(1));
        CHECK(!header.find({"missing"}));
    }

    void test_schedule_parsing()
    {
        CHECK(parse_clock("09:30") == std::optional<Minute>(570));
        CHECK(parse_clock("24:00") == std::optional<Minute>(kMinutesPerDay));
        CHECK(!parse_clock("25:00"));
        CHECK(!parse_clock("9h30"));

        const auto two = parse_day_hours("06:00-07:00,11:30-12:30");
        CHECK(two && two->size() == 2 && (*two)[1].start == 690);
        CHECK(parse_day_hours("") && parse_day_hours("")->empty());
        CHECK(parse_day_hours("anytime") && (*parse_day_hours("anytime"))[0].is_all_day());
        CHECK(!parse_day_hours("17:00-09:00"));

        CHECK(parse_date("2026-11-09") == std::optional<DateKey>(20261109));
        CHECK(!parse_date("2026-02-30"));
        CHECK(weekday_of(20261109) == 0); // Monday
        CHECK(weekday_of(20261115) == 6); // Sunday

        CHECK(format_clock_12h(1170) == "7:30 PM");
        CHECK(format_clock_12h(720) == "12 PM");
        CHECK(format_clock_12h(kMinutesPerDay) == "midnight");

        const auto t = parse_local_datetime("2026-11-13T19:05");
        CHECK(t && t->date == 20261113 && t->weekday == 4 && t->minute == 1145);
    }

    void test_geo()
    {
        const GeoPoint stauffer{44.22816, -76.49585}, goodwin{44.22794, -76.49233};
        CHECK(distance_m(stauffer, stauffer) < 0.001);
        const int walk = walk_minutes(stauffer, goodwin); // ~280 m apart
        CHECK(walk >= 3 && walk <= 6);
    }

    const char* kActivities =
      "Name,Category,Description,Place,lat,lng,duration,cost,mon,tue,wed,thurs,fri,sat,sun,date\n"
      "Library,SLOW DOWN,Read,Stauffer,44.22816,-76.49585,30,free,08:00-24:00,,,,,,,\n"
      "Talk,EVENTS,Lecture,Goodwin,44.22794,-76.49233,60,free,13:00-14:00,,,,,,,2026-11-09\n"
      "Far away,EVENTS,Island,Wolfe Island,44.19448,-76.43861,60,$$,anytime,,,,,,,\n"
      "Broken,EVENTS,Bad hours,Nowhere,44.2,-76.4,30,free,soon,,,,,,,\n";

    void test_loader()
    {
        std::istringstream in(kActivities);
        const auto result = parse_activities(in);
        CHECK(result.items.size() == 3);
        CHECK(result.warnings.size() == 1);
        CHECK(result.warnings[0].find("row 5") == 0);
        CHECK(result.items[0].cost == Cost::Free);

        std::istringstream locs("id,name,lat,lng\nhere,Here,44.2,-76.5\nanywhere,Anywhere,,\n");
        const auto locations = parse_locations(locs);
        CHECK(locations.items.size() == 2);
        CHECK(locations.items[0].point.has_value());
        CHECK(!locations.items[1].point.has_value());
    }

    void test_recommender()
    {
        std::istringstream in(kActivities);
        const Recommender recommender(parse_activities(in).items);
        CHECK(recommender.activities().size() == 2); // Wolfe Island is beyond walking range

        const Location stauffer{"stauffer", "Stauffer", GeoPoint{44.22816, -76.49585}};
        const LocalTime mondayNoon{20261109, 0, 12 * 60};

        // 45 minutes at noon: the library fits; the 1 PM talk does not (wait + 60 min is too long).
        auto fits = recommender.recommend({45, &stauffer, mondayNoon});
        CHECK(fits.size() == 1 && fits[0].activity->name == "Library");
        CHECK(fits[0].walk == 0 && fits[0].total == 30);

        // 2+ hours at 12:40: the talk fits after a short wait.
        fits = recommender.recommend({120, &stauffer, {20261109, 0, 12 * 60 + 40}});
        CHECK(fits.size() == 2);
        bool sawTalk = false;
        for (const auto& s : fits)
            if (s.activity->name == "Talk") sawTalk = s.startsAt == 13 * 60 && s.wait > 0;
        CHECK(sawTalk);

        // The talk is a one-day event: nothing on the following Monday.
        fits = recommender.recommend({120, &stauffer, {20261116, 0, 12 * 60 + 40}});
        CHECK(fits.size() == 1);

        // Too late in the day for the library to fit before midnight.
        fits = recommender.recommend({60, &stauffer, {20261109, 0, 23 * 60 + 45}});
        CHECK(fits.empty());

        // Tuesday: library closed.
        CHECK(recommender.recommend({60, &stauffer, {20261110, 1, 12 * 60}}).empty());
    }
}

int main()
{
    test_csv();
    test_schedule_parsing();
    test_geo();
    test_loader();
    test_recommender();

    std::cout << (checks - failures) << "/" << checks << " checks passed\n";
    return failures == 0 ? 0 : 1;
}
