#pragma once

#include <optional>
#include <string_view>

#include "schedule.h"

namespace bib
{
    /// Current time in Kingston (America/Toronto), whatever the server's own time zone is.
    LocalTime now_in_kingston();

    /// "YYYY-MM-DDTHH:MM" -> LocalTime. Lets the API answer "what if it were Friday at 7 PM?".
    std::optional<LocalTime> parse_local_datetime(std::string_view text);
}
