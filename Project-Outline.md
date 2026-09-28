# Board I'm Bored

## Idea

**Board I'm Bored** is a web app you go to when you're bored in the middle of the day. Instead of scrolling through social media, Board I'm Bored keeps students present.

1. You start by clicking the **"Board I'm Bored"** button.
2. Board I'm Bored asks two questions:
   - How long have you got?
   - Where are you?
3. Board I'm Bored creates a list of all the activities you can do in the time you have.

### Activity Sources

Activities include, but are not limited to:

- Drop-in Rec Sports
- Food Spots (+ commute time and food prep time)
- Luma Events
- QU Career Event Calendar
- Library Capacity
- All Eng Newsletter
- Quiet Spots
- Scenic Strolls
- Student Club Events (may include a personalized relevancy score)

## Architecture

| Layer    | Language / Tooling | Framework            |
|----------|--------------------|----------------------|
| Backend  | C++                | Crow (web service)   |
| Frontend | Vite               | React, Tailwind      |

## MVP

1. User opens the app when they have free time during the day.
2. User clicks the **"Board I'm Bored"** button.
3. App asks two questions: *Where are you?* and *How much time do you have?*
4. App returns a list of suggested activities that can be completed in the allotted time.

## Suggested Additional Features

- **Class schedule integration**
- **Favourites:** users can star their favourite activities
- **Preference questionnaire:** a quick quiz to gauge the type of activity the user wants to do
- **Commute awareness:** factor in how the user gets around, including parking and bus routes