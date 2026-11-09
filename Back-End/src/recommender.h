#pragma once

#include <optional>
#include <vector>

#include "activity.h"
#include "location.h"
#include "schedule.h"

namespace bib
{
    struct RecommenderConfig
    {
        GeoPoint campusCentre{44.22816, -76.49585}; // Stauffer Library
        int maxWalkFromCampus = 30;  // MVP is walking-only: drop anything farther than this
        int openEndedFrom = 120;     // "2+ hours" in the UI sends 120
        int openEndedBudget = 180;   // ...which we treat as this many minutes
    };

    struct Query
    {
        int minutes;            // how long the user has, including getting back
        const Location* from;   // where they are now
        LocalTime now;
    };

    /// One activity that fits, with the plan worked out.
    struct Suggestion
    {
        const Activity* activity;
        int walk;        // one way, minutes
        int wait;        // minutes between arriving and starting (events that haven't begun)
        Minute startsAt; // local clock time the user starts the activity
        TimeRange window; // the opening range used
        int total;       // walk there + wait + activity + walk back
        int budget;      // minutes the user had (after "2+ hours" is expanded)
    };

    /// Filters and ranks activities. Holds its data immutably, so one instance
    /// can serve concurrent requests without locking.
    class Recommender
    {
      public:
        Recommender(std::vector<Activity> activities, RecommenderConfig config = {});

        /// Activities that fit, best first.
        std::vector<Suggestion> recommend(const Query& query) const;

        const std::vector<Activity>& activities() const { return activities_; }

      private:
        std::optional<Suggestion> evaluate(const Activity& activity, const Query& query, int budget) const;

        std::vector<Activity> activities_;
        RecommenderConfig config_;
    };
}
