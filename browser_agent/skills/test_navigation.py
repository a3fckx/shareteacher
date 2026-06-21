from typing import Any
from browser_use import Browser

async def run(browser: Browser, **args) -> dict[str, Any]:
    """Test skill to navigate to a page and return its title."""
    url = args.get("url", "https://example.com")
    page = await browser.get_current_page()
    await page.goto(url)
    title = await page.title()
    return {"url": url, "title": title}
