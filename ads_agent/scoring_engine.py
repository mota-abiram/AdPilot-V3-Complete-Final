import math

def safe_div(a, b):
    return a / b if b > 0 else 0

def get_band_from_score(score_100):
    """Unified banding logic: 0-100 normalized score to qualitative band."""
    if score_100 >= 85: return "excellent"
    if score_100 >= 70: return "good"
    if score_100 >= 40: return "watch"
    return "poor"

def score_linear(actual, target, weight, lower_is_better=True):
    """
    Standard linear scoring: 
    If actual == target, score = weight
    Normalized score (0-100) is used to determine the band.
    """
    if target <= 0:
        return weight * 0.5, "no_data"
    
    if lower_is_better:
        if actual <= target * 0.8:
            return weight, "excellent"
        if actual >= target * 1.5:
            return 0, "poor"
        # Linear interp between 1.5 and 0.8
        ratio = actual / target
        score_ratio = (1.5 - ratio) / (1.5 - 0.8)
        score_ratio = max(0, min(1, score_ratio))
        score_100 = score_ratio * 100
        return round(weight * score_ratio, 2), get_band_from_score(score_100)
    else:
        if actual >= target * 1.2:
            return weight, "excellent"
        if actual <= target * 0.5:
            return 0, "poor"
        # Linear interp between 0.5 and 1.2
        ratio = actual / target
        score_ratio = (ratio - 0.5) / (1.2 - 0.5)
        score_ratio = max(0, min(1, score_ratio))
        score_100 = score_ratio * 100
        return round(weight * score_ratio, 2), get_band_from_score(score_100)

def score_impression_share(actual_is, target_is):
    """
    Google graded IS scoring:
    ≥ Target -> 100% score
    70% of target -> 75% score
    50% of target -> 40% score
    <50% of target -> 10% score
    """
    if target_is <= 0:
        return 50  # Default
    
    ratio = actual_is / target_is
    if ratio >= 1.0:
        return 100
    if ratio >= 0.7:
        # Interpolate between 75% and 100%
        return 75 + (ratio - 0.7) / (1.0 - 0.7) * 25
    if ratio >= 0.5:
        # Interpolate between 40% and 75%
        return 40 + (ratio - 0.5) / (0.7 - 0.5) * 35
    # Interpolate between 10% and 40%
    return max(10, 10 + (ratio / 0.5) * 30)

def normalize_score(score_map, total_weight=100):
    total = sum(score_map.values())
    if total_weight != 100:
        total = (total / total_weight) * 100
    return round(max(0, min(100, total)), 1)

def get_interpretation(score):
    if score >= 75: return "HEALTHY", "green"
    if score >= 50: return "WATCH", "yellow"
    return "PAUSE/INTERVENE", "red"

# --- Overall Health Functions ---

def calculate_meta_health(mtd_data, creative_avg):
    """
    Meta: CPSV (25), Budget (25), CPQL (20), CPL (20), Creative (10)
    """
    w = {"cpsv": 25, "budget": 25, "cpql": 20, "cpl": 20, "creative": 10}
    breakdown = {}
    
    t = mtd_data.get("targets", {})
    
    breakdown["cpsv"], _ = score_linear(mtd_data.get("cpsv", 0), t.get("cpsv", 20000), 100, True)
    
    # Budget pacing score: 100 if dev < 10%, linear drop
    pacing_dev = abs(mtd_data.get("pacing_ratio", 1.0) - 1.0)
    breakdown["budget"] = round(100 * max(0, 1 - (pacing_dev * 2)), 2)
    
    breakdown["cpql"], bands["cpql"] = score_linear(mtd_data.get("cpql", 0), t.get("cpql", 1500), 100, True)
    breakdown["cpl"], bands["cpl"] = score_linear(mtd_data.get("cpl", 0), t.get("cpl", 850), 100, True)
    breakdown["creative"] = round(creative_avg, 2)
    bands["creative"] = get_band_from_score(creative_avg)
    
    total_score = sum((breakdown[k] * w[k] / 100) for k in w)
    return {"score": round(max(0, min(100, total_score)), 1), "breakdown": breakdown, "bands": bands}

def calculate_google_health(mtd_data, campaign_avg, creative_avg):
    """
    Google: CPSV (25), Budget (20), CPQL (20), CPL (10), Campaign (15), Creative (10)
    """
    w = {"cpsv": 25, "budget": 20, "cpql": 20, "cpl": 10, "campaign": 15, "creative": 10}
    breakdown = {}
    
    t = mtd_data.get("targets", {})
    
    breakdown["cpsv"], _ = score_linear(mtd_data.get("cpsv", 0), t.get("cpsv", 20000), 100, True)
    
    pacing_dev = abs(mtd_data.get("pacing_ratio", 1.0) - 1.0)
    breakdown["budget"] = round(100 * max(0, 1 - (pacing_dev * 2)), 2)
    
    breakdown["cpql"], _ = score_linear(mtd_data.get("cpql", 0), t.get("cpql", 1500), 100, True)
    breakdown["cpl"], _ = score_linear(mtd_data.get("cpl", 0), t.get("cpl", 850), 100, True)
    breakdown["campaign"] = round(campaign_avg, 2)
    breakdown["creative"] = round(creative_avg, 2)
    
    total_score = sum((breakdown[k] * w[k] / 100) for k in w)
    return {"score": round(max(0, min(100, total_score)), 1), "breakdown": breakdown}

# --- Module Specific Scorers ---

def score_meta_campaign_module(data, target_cpl):
    """
    Meta Campaign: CPL (35), Freq (15), CPM (15), CTR (10), Leads (10), Budget (10), CVR (5)
    """
    w = {"cpl": 35, "freq": 15, "cpm": 15, "ctr": 10, "leads": 10, "budget": 10, "cvr": 5}
    breakdown = {}
    bands = {}
    
    breakdown["cpl"], bands["cpl"] = score_linear(data.get("cpl", 0), target_cpl, 100, True)
    breakdown["freq"], bands["freq"] = score_linear(data.get("frequency", 0), 1.8, 100, True)
    breakdown["cpm"], bands["cpm"] = score_linear(data.get("cpm", 0), 200, 100, True)
    breakdown["ctr"], bands["ctr"] = score_linear(data.get("ctr", 0), 0.8, 100, False)
    
    # Lead volume vs expected (spend / target_cpl)
    expected_leads = data.get("spend", 0) / target_cpl if target_cpl > 0 else 0
    leads = data.get("leads", 0)
    lead_score = round(100 * min(1, safe_div(leads, expected_leads)), 2) if expected_leads > 0 else 50
    breakdown["leads"] = lead_score
    bands["leads"] = get_band_from_score(lead_score)
    
    util = data.get("budget_utilization", 100)
    budget_score = round(100 * (1 - min(1, abs(util - 100)/100)), 2)
    breakdown["budget"] = budget_score
    bands["budget"] = get_band_from_score(budget_score)
    
    breakdown["cvr"], bands["cvr"] = score_linear(data.get("cvr", 0), 2.0, 100, False)
    
    total_score = sum((breakdown[k] * w[k] / 100) for k in w)
    return {"score": round(max(0, min(100, total_score)), 1), "breakdown": breakdown, "bands": bands}

def score_meta_creative_module(data, target_cpl):
    is_video = data.get("is_video", False)
    breakdown = {}
    if is_video:
        # Meta Video: CPL (35), CPM (20), TSR (15), VHR (15), CTR (15)
        w = {"cpl": 35, "cpm": 20, "tsr": 15, "vhr": 15, "ctr": 15}
        breakdown["cpl"], _ = score_linear(data.get("cpl", 0), target_cpl, 100, True)
        breakdown["cpm"], _ = score_linear(data.get("cpm", 0), 200, 100, True)
        breakdown["tsr"], _ = score_linear(data.get("thumb_stop_pct", 0), 25, 100, False)
        breakdown["vhr"], _ = score_linear(data.get("hold_rate_pct", 0), 25, 100, False)
        breakdown["ctr"], _ = score_linear(data.get("ctr", 0), 0.8, 100, False)
    else:
        # Meta Static: CPL (45), CPM (25), CTR (20), CPC (10)
        w = {"cpl": 45, "cpm": 25, "ctr": 20, "cpc": 10}
        breakdown["cpl"], _ = score_linear(data.get("cpl", 0), target_cpl, 100, True)
        breakdown["cpm"], _ = score_linear(data.get("cpm", 0), 150, 100, True)
        breakdown["ctr"], _ = score_linear(data.get("ctr", 0), 0.6, 100, False)
        breakdown["cpc"], _ = score_linear(data.get("avg_cpc", 0), 40, 100, True)
    
    total_score = sum((breakdown[k] * w[k] / 100) for k in w)
    return {"score": round(max(0, min(100, total_score)), 1), "breakdown": breakdown}

def score_google_campaign_module(data, target_cpl):
    """
    Google Search Campaign: CPL (25), CVR (22), CPC (20), QS (13), CTR (10), IS (10)
    """
    w = {"cpl": 25, "cvr": 22, "cpc": 20, "qs": 13, "ctr": 10, "is": 10}
    breakdown = {}
    bands = {}
    
    breakdown["cpl"], bands["cpl"] = score_linear(data.get("cpl", 0), target_cpl, 100, True)
    breakdown["cvr"], bands["cvr"] = score_linear(data.get("cvr", 0), 3.5, 100, False)
    breakdown["cpc"], bands["cpc"] = score_linear(data.get("avg_cpc", 0), 30, 100, True)
    
    qs_raw = data.get("quality_score", 5)
    breakdown["qs"] = round(qs_raw / 10 * 100, 2)
    bands["qs"] = get_band_from_score(breakdown["qs"])
    
    breakdown["ctr"], bands["ctr"] = score_linear(data.get("ctr", 0), 2.0, 100, False)
    
    # Impression Share
    ctype = data.get("campaign_type", "branded")
    is_target = 80 if "branded" in ctype.lower() else 40
    is_score = round(score_impression_share(data.get("impression_share", 0), is_target), 2)
    breakdown["is"] = is_score
    bands["is"] = get_band_from_score(is_score)
    
    total_score = sum((breakdown[k] * w[k] / 100) for k in w)
    return {"score": round(max(0, min(100, total_score)), 1), "breakdown": breakdown, "bands": bands}

def score_google_adgroup_module(data, target_cpl):
    """
    Google Search Ad Group: CPL (30), CVR (25), CTR (15), QS (15), IS (10), CPC (5)
    """
    w = {"cpl": 30, "cvr": 25, "ctr": 15, "qs": 15, "is": 10, "cpc": 5}
    breakdown = {}
    
    breakdown["cpl"], _ = score_linear(data.get("cpl", 0), target_cpl, 100, True)
    breakdown["cvr"], _ = score_linear(data.get("cvr", 0), 3.5, 100, False)
    breakdown["ctr"], _ = score_linear(data.get("ctr", 0), 2.0, 100, False)
    breakdown["qs"] = round(data.get("quality_score", 5) / 10 * 100, 2)
    
    ctype = data.get("campaign_type", "location")
    is_target = 80 if "branded" in ctype.lower() else 40
    breakdown["is"] = round(score_impression_share(data.get("impression_share", 0), is_target), 2)
    breakdown["cpc"], _ = score_linear(data.get("avg_cpc", 0), 30, 100, True)
    
    total_score = sum((breakdown[k] * w[k] / 100) for k in w)
    return {"score": round(max(0, min(100, total_score)), 1), "breakdown": breakdown}

def score_google_dg_module(data, target_cpl):
    """
    Google Demand Gen: CPL (25), CPM (20), CVR (15), CTR (15), TSR (7.5), Freq (10), VHR (7.5)
    """
    w = {"cpl": 25, "cpm": 20, "cvr": 15, "ctr": 15, "tsr": 7.5, "freq": 10, "vhr": 7.5}
    breakdown = {}
    
    breakdown["cpl"], _ = score_linear(data.get("cpl", 0), target_cpl, 100, True)
    breakdown["cpm"], _ = score_linear(data.get("avg_cpm", 0), 120, 100, True)
    breakdown["cvr"], _ = score_linear(data.get("cvr", 0), 1.5, 100, False)
    breakdown["ctr"], _ = score_linear(data.get("ctr", 0), 0.8, 100, False)
    breakdown["tsr"], _ = score_linear(data.get("tsr", 0), 3.5, 100, False)
    breakdown["freq"], _ = score_linear(data.get("frequency", 0), 2.0, 100, True)
    breakdown["vhr"], _ = score_linear(data.get("vhr", 0), 30, 100, False)
    
    total_score = sum((breakdown[k] * w[k] / 100) for k in w)
    return {"score": round(max(0, min(100, total_score)), 1), "breakdown": breakdown}

def score_google_rsa_module(data, target_cpl):
    """
    Google RSA: CPL (35), CTR (25), CVR (20), Ad Strength (10), Expected CTR (10)
    """
    w = {"cpl": 35, "ctr": 25, "cvr": 20, "ad_strength": 10, "expected_ctr": 10}
    breakdown = {}
    
    breakdown["cpl"], _ = score_linear(data.get("cpl", 0), target_cpl, 100, True)
    breakdown["ctr"], _ = score_linear(data.get("ctr", 0), 2.0, 100, False)
    breakdown["cvr"], _ = score_linear(data.get("cvr", 0), 3.0, 100, False)
    
    strength_map = {"EXCELLENT": 1.0, "GOOD": 0.8, "AVERAGE": 0.5, "POOR": 0.2, "LOW": 0.1, "UNSPECIFIED": 0.5}
    strength = data.get("ad_strength", "AVERAGE").upper()
    breakdown["ad_strength"] = round(strength_map.get(strength, 0.5) * 100, 2)
    
    exp_ctr_map = {"ABOVE_AVERAGE": 1.0, "AVERAGE": 0.6, "BELOW_AVERAGE": 0.2, "UNSPECIFIED": 0.5}
    exp_ctr = data.get("expected_ctr", "AVERAGE").upper()
    breakdown["expected_ctr"] = round(exp_ctr_map.get(exp_ctr, 0.5) * 100, 2)
    
    total_score = sum((breakdown[k] * w[k] / 100) for k in w)
    return {"score": round(max(0, min(100, total_score)), 1), "breakdown": breakdown}

def score_google_creative_module(data, target_cpl):
    is_video = "VIDEO" in data.get("type", "").upper() or data.get("is_video", False)
    breakdown = {}
    if is_video:
        # Google Video: CPL (35), CPM (20), CTR (15), TSR (15), VHR (15)
        w = {"cpl": 35, "cpm": 20, "ctr": 15, "tsr": 15, "vhr": 15}
        breakdown["cpl"], _ = score_linear(data.get("cpl", 0), target_cpl, 100, True)
        breakdown["cpm"], _ = score_linear(data.get("avg_cpm", 0), 120, 100, True)
        breakdown["ctr"], _ = score_linear(data.get("ctr", 0), 0.8, 100, False)
        breakdown["tsr"], _ = score_linear(data.get("tsr", 0), 3.5, 100, False)
        breakdown["vhr"], _ = score_linear(data.get("vhr", 0), 30, 100, False)
    else:
        # Google Static: CPL (45), CPM (25), CTR (20), CPC (10)
        w = {"cpl": 45, "cpm": 25, "ctr": 20, "cpc": 10}
        breakdown["cpl"], _ = score_linear(data.get("cpl", 0), target_cpl, 100, True)
        breakdown["cpm"], _ = score_linear(data.get("avg_cpm", 0), 80, 100, True)
        breakdown["ctr"], _ = score_linear(data.get("ctr", 0), 0.6, 100, False)
        breakdown["cpc"], _ = score_linear(data.get("avg_cpc", 0), 20, 100, True)
    
    total_score = sum((breakdown[k] * w[k] / 100) for k in w)
    return {"score": round(max(0, min(100, total_score)), 1), "breakdown": breakdown}

# --- Quality Score Page Scorer ---

def score_quality_score_page(data):
    """
    Quality Score Page: LP Exp (35), Expected CTR (35), Ad Relevance (30)
    """
    w = {"lp_exp": 35, "exp_ctr": 35, "ad_rel": 30}
    scores = {}
    
    mapping = {"ABOVE_AVERAGE": 1.0, "AVERAGE": 0.6, "BELOW_AVERAGE": 0.2, "UNSPECIFIED": 0.5}
    
    scores["lp_exp"] = round(mapping.get(data.get("landing_page_experience", "AVERAGE").upper(), 0.5) * w["lp_exp"], 2)
    scores["exp_ctr"] = round(mapping.get(data.get("expected_click_through_rate", "AVERAGE").upper(), 0.5) * w["exp_ctr"], 2)
    scores["ad_rel"] = round(mapping.get(data.get("ad_relevance", "AVERAGE").upper(), 0.5) * w["ad_rel"], 2)
    
    return {"score": normalize_score(scores), "breakdown": scores}
