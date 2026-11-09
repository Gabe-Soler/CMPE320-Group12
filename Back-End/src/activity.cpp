#include "activity.h"

namespace bib
{
    Cost parse_cost(std::string_view text)
    {
        if (text == "free") return Cost::Free;
        if (text == "$") return Cost::Low;
        if (text == "$$") return Cost::High;
        return Cost::Unknown;
    }

    std::string_view to_string(Cost cost)
    {
        switch (cost)
        {
            case Cost::Free: return "free";
            case Cost::Low: return "$";
            case Cost::High: return "$$";
            case Cost::Unknown: break;
        }
        return "";
    }
}
