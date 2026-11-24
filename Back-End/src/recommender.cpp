#include "recommender.h"

#include <algorithm>
#include <tuple>

namespace bib
{
    namespace
    {
        constexpr int kWalkBucket = 5; // walks within the same 5 minutes count as equally close
    }

    Recommender::Recommender(std::vector<Activity> activities, RecommenderConfig config)
        : config_(config)
    {
        // Walking-only MVP: anything too far from campus can never be suggested, so drop it once here
        // instead of re-checking it on every request.
        activities.erase(std::remove_if(activities.begin(), activities.end(),
                                        [&](const Activity& a) {
                                            return walk_minutes(config_.campusCentre, a.where) >
                                                   config_.maxWalkFromCampus;
                                        }),
                         activities.end());
        activities_ = std::move(activities);
    }

    std::optional<Suggestion> Recommender::evaluate(const Activity& activity, const Query& query, int budget) const
    {
        const int walkThere = query.from->point ? walk_minutes(*query.from->point, activity.where) : 0;
        // Ordinary search (no until, no destination): round trip. Next-class destination: walk there.
        // Free period with no next class (until set, to null): one-way — do not invent a return walk.
        const int walkAfter = (query.to && query.to->point) ? walk_minutes(activity.where, *query.to->point)
                           : query.until                    ? 0
                                                            : walkThere;
        if (walkThere + activity.duration + walkAfter > budget) return std::nullopt;

        Minute latestArrival = query.now.minute + budget;
        if (query.until)
        {
            const Minute deadline = *query.until - query.arrivalBuffer;
            if (deadline < latestArrival) latestArrival = deadline;
        }
        if (latestArrival <= query.now.minute) return std::nullopt;

        const Minute arrive = query.now.minute + walkThere;
        for (const TimeRange& range : activity.schedule.ranges_on(query.now.date, query.now.weekday))
        {
            // Start as soon as we arrive, or wait for it to open; it must still be open when we finish.
            const Minute start = std::max(arrive, range.start);
            if (start + activity.duration > range.end) continue;

            const Minute doneAtNext = start + activity.duration + walkAfter;
            if (doneAtNext > latestArrival) continue;

            const int total = (start - query.now.minute) + activity.duration + walkAfter;
            if (total > budget) continue;

            // Ranges are in time order, so the first that fits is the earliest start.
            return Suggestion{&activity, walkThere, walkAfter, start - arrive, start, range, total, budget};
        }
        return std::nullopt;
    }

    std::vector<Suggestion> Recommender::recommend(const Query& query) const
    {
        // Finder "2+ hours" is open-ended. A schedule break has a real `until`, so use the gap as-is.
        const int budget = (!query.until && query.minutes >= config_.openEndedFrom)
                               ? config_.openEndedBudget
                               : query.minutes;

        std::vector<Suggestion> fits;
        for (const Activity& activity : activities_)
            if (auto suggestion = evaluate(activity, query, budget)) fits.push_back(*suggestion);

        // Closest first (in 5-minute buckets, counting any wait), then whatever uses more of the free time.
        std::sort(fits.begin(), fits.end(), [](const Suggestion& a, const Suggestion& b) {
            const auto key = [](const Suggestion& s) {
                return std::make_tuple((s.walk + s.wait) / kWalkBucket, -s.activity->duration, s.activity->id);
            };
            return key(a) < key(b);
        });
        return fits;
    }
}
